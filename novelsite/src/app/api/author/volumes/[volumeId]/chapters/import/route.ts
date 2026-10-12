import { NextResponse } from 'next/server';
import { assertSameOrigin, requireAuthorForAction } from '@/lib/auth/guard';
import { serviceErrorResponse } from '@/lib/auth/routeHelpers';
import { ServiceError } from '@/lib/services/errors';
import { IMPORT_LIMITS } from '@/lib/validation/chapterImport';
import { logImportEvent, type ImportResult } from '@/lib/chapterImport/log';
import { importChapters, type ImportFileInput } from '@/lib/services/chapterImportService';

/**
 * `POST /api/author/volumes/{volumeId}/chapters/import`（contracts/batch-import-api.md §1）
 * =========================================================================================
 * 站上第一個 multipart 端點。**走 Route Handler 而非 Server Action** 有兩個各自足以決定的理由
 * （research R-1）：`serverActions.bodySizeLimit` 是 `next.config` 的**全域**設定，
 * 為匯入調高等於把站上每一個 Server Action 都變成 50 MB 的入口；
 * 且 Server Action 拿不到原始 `Request`，滿足不了 FR-017b「緩衝完整內容之前依宣告長度拒絕」。
 *
 * **處理順序為規範性**（契約 §1.4），前三步在碰 request body 之前完成：
 *
 * 1. `assertSameOrigin` → 403（Route Handler 沒有框架內建的 CSRF 比對）
 * 2. `Content-Type` 必須是 multipart/form-data → 400
 * 3. `Content-Length` 存在且 ≤ 50 MB → 400（**缺漏亦拒絕**）
 * 4. `requireAuthorForAction` → 401 / 403
 * 5. `request.formData()` ← 此時才緩衝
 * 6. 檔案數 ≤ 1000、逐檔 ≤ 1 MB → 400
 * 7. 服務層：擁有權 → 全量重驗 → 交易寫入
 * 8. `logImportEvent` ← **每一個出口都要執行**，含前四步的提前返回
 *
 * **第 2、3 步排在身分驗證之前是刻意的**（FR-015a、契約 §1.5）：第 3 步是 FR-017b
 * 「緩衝完整內容之前」的唯一著力點，排到身分之後就得先把 50 MB 收下來。
 * 其結果是**未登入者對格式不合的請求得到 400 而非 401**，
 * **MUST NOT 當成 bug 調換順序**。
 *
 * **第 3 步缺 `Content-Length` 一律拒絕**，MUST NOT「缺了就跳過檢查」——
 * 跳過等於為 chunked 傳輸開一個不設限的洞，而 FR-017b 的整條防線就在這一關。
 *
 * 錯誤一律經既有 `serviceErrorResponse` 轉譯，**不新增 `ErrorCode`**（契約 §1.3 的註）。
 */

interface Ctx {
  params: Promise<{ volumeId: string }>;
}

/** `ServiceError` → 匯入紀錄的 `result`。九個值一一對應契約 §1.4 的出口（契約 §4） */
function resultOfError(err: unknown): ImportResult {
  if (!(err instanceof ServiceError)) return 'internal_error';
  switch (err.code) {
    case 'VALIDATION_ERROR':
      return 'validation_error';
    case 'UNAUTHENTICATED':
      return 'unauthenticated';
    case 'FORBIDDEN':
      return 'forbidden';
    case 'NOT_FOUND':
      return 'not_found';
    case 'CONFLICT':
      return 'conflict';
    default:
      return 'internal_error';
  }
}

export async function POST(request: Request, ctx: Ctx) {
  const startedAt = Date.now();
  const { volumeId } = await ctx.params;

  let actorId: string | null = null;
  // 服務層自 volumeId 反查而得，Route Handler 取不到（端點層 MUST NOT 直接觸及資料存取層）——
  // 故在服務層回傳之前一律為 null，契約 §4 明訂此時如此。成功出口填入實際值（FEAT-7 T017）
  let novelId: string | null = null;
  let fileCount = 0;
  let totalBytes = 0;

  /** 每一個出口都經此記錄一行（FR-016b）。**MUST NOT 因為值不齊就略過記錄** */
  const log = (result: ImportResult) =>
    logImportEvent({
      actorId,
      novelId,
      volumeId,
      fileCount,
      totalBytes,
      result,
      durationMs: Date.now() - startedAt,
    });

  const fail = (err: unknown, result: ImportResult) => {
    log(result);
    return serviceErrorResponse(err);
  };

  // 1：來源比對。排在身分之前 —— 它擋的是「借使用者的 Cookie 從別的網站發請求」，
  // 那種請求的身分驗證會通過（契約 §1.5）
  try {
    assertSameOrigin(request);
  } catch (err) {
    return fail(err, 'origin_rejected');
  }

  // 2：請求格式
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return fail(
      new ServiceError('VALIDATION_ERROR', '請以 multipart/form-data 送出匯入請求'),
      'bad_request'
    );
  }

  // 3：宣告長度（FR-017b 的唯一著力點）
  const declared = request.headers.get('content-length');
  if (declared === null) {
    return fail(
      new ServiceError('VALIDATION_ERROR', '請求缺少 Content-Length，無法在讀取內容前判定大小'),
      'bad_request'
    );
  }
  const declaredBytes = Number(declared);
  if (!Number.isInteger(declaredBytes) || declaredBytes < 0) {
    return fail(
      new ServiceError('VALIDATION_ERROR', 'Content-Length 不是有效的位元組數'),
      'bad_request'
    );
  }
  totalBytes = declaredBytes;
  if (declaredBytes > IMPORT_LIMITS.maxTotalBytes) {
    // FR-018：訊息 MUST 同時含實際值與上限值
    return fail(
      new ServiceError(
        'VALIDATION_ERROR',
        `總大小 ${declaredBytes} 位元組，上限 ${IMPORT_LIMITS.maxTotalBytes} 位元組`
      ),
      'bad_request'
    );
  }

  // 4：身分 → 角色
  let uid: string;
  try {
    const session = await requireAuthorForAction();
    uid = session.uid;
    actorId = session.uid;
  } catch (err) {
    return fail(err, resultOfError(err));
  }

  // 5：此時才緩衝
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(
      new ServiceError('VALIDATION_ERROR', '請求內容不是有效的 multipart/form-data'),
      'bad_request'
    );
  }

  // 6：檔案數與逐檔大小。**檔案數只能在此判定** —— multipart 沒有宣告 part 數的標頭，
  // 總量已由第 3 步封頂（research R-11）
  const parts = form.getAll('files').filter((value): value is File => value instanceof File);
  fileCount = parts.length;

  if (fileCount > IMPORT_LIMITS.maxFiles) {
    return fail(
      new ServiceError(
        'VALIDATION_ERROR',
        `已選 ${fileCount} 個，上限 ${IMPORT_LIMITS.maxFiles} 個`
      ),
      'validation_error'
    );
  }
  const oversized = parts.find((part) => part.size > IMPORT_LIMITS.maxFileBytes);
  if (oversized) {
    // FR-019：逐檔判定類的錯誤 MUST 指名是哪一個來源檔
    return fail(
      new ServiceError(
        'VALIDATION_ERROR',
        `${oversized.name}：單檔 ${oversized.size} 位元組，上限 ${IMPORT_LIMITS.maxFileBytes} 位元組`
      ),
      'validation_error'
    );
  }

  // 7：服務層。解碼、淨化與字數在那一層完成（與單章路徑同一組函式）
  try {
    const files: ImportFileInput[] = await Promise.all(
      parts.map(async (part) => ({
        filename: part.name,
        byteSize: part.size,
        bytes: new Uint8Array(await part.arrayBuffer()),
      }))
    );

    // `novelId` 只餵匯入紀錄，**MUST NOT 出現在回應主體**：契約 §1.2 的成功形狀
    // 恰為 `created`／`numbers`／`chapterCount`／`wordCount` 四欄
    const { novelId: importedNovelId, ...body } = await importChapters(uid, { volumeId, files });
    novelId = importedNovelId;
    log('ok');
    return NextResponse.json(body);
  } catch (err) {
    return fail(err, resultOfError(err));
  }
}
