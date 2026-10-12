import { describe, it, expect, beforeAll } from 'vitest';
import { auditPage } from './axeHelper';
import { baseUrl, loginAs, testFetch } from '../helpers/client';
import { callAction } from '../helpers/serverAction';
import { readOutbox, waitForMail, extractResetToken } from '../helpers/outbox';

/**
 * 頁面層 a11y 稽核（FR-054、SC-013）：本階段新增／修改的 13 個頁面，違規數皆須為 0。
 * 判準見 tasks.md T074 —— 版面或控制項有可見／語意變更者入列；跨頁基礎設施（nonce、
 * SessionProvider）不使全站 26 頁皆入列。
 *
 * 帳號來源 MUST 為示範資料建立的帳號，經 HTTP 登入取得 Cookie（本套件不清空認證域，
 * 示範帳號全程在庫；MUST NOT 用 fixtures.ts 的 createUser() —— 該檔經 repositories/*
 * 帶 server-only，a11y 設定檔的解析條件下會擲錯）。
 *
 * 登入 MUST 每個角色只呼叫一次 loginAs 並重用 Cookie（FR-052）—— 登入位址鍵 5 次／分鐘，
 * 8 個受保護頁逐頁登入會在第 6 次起被 429。
 */

let readerCookie: string;
let authorCookie: string;
let novelId: string;
let readerChapterId: string;

const SEED_PASSWORD = process.env.SEED_USER_PASSWORD!;

/**
 * 作者自己的作品與章節（FEAT-3 T055）。
 *
 * **為何改為當場建立**：作者後台的擁有者已由 `DEMO_AUTHOR_ID` 改為登入的工作階段
 * （T052／T053），登入帳號 `author@novelsite.tw` 名下本來就沒有任何作品 ——
 * 先前指向示範草稿 `draft-1` 的固定常數現在會 404，而 404 頁面照樣可能零違規，
 * 那會讓這個檢查安靜地失去意義。
 *
 * 建立方式是**打真正的 Server Action**（與作者在畫面上做的完全同一條路徑），
 * 不經 repository —— 本套件的解析條件下 `server-only` 會擲錯（見檔頭說明）。
 */
let authorNovelId: string;
let authorChapterId: string;

/**
 * 重設密碼頁的**真** token（FEAT-5 T038）。
 *
 * **MUST 用真 token**：帶假 token 渲染的是「連結已失效」，那個畫面照樣可能零違規，
 * 而真正要稽核的表單根本沒被渲染 —— 稽核會安靜地失去意義。
 *
 * 取得方式是申請一次重設並自 outbox 讀回（`MAIL_MODE=memory`）。
 * **只申請、不確認**，故示範帳號的密碼不變，其餘稽核項目不受影響。
 *
 * MUST NOT 呼叫 `clearOutbox()`（本套件與整合套件共用同一個落地檔），
 * 而**正因為不清檔，MUST 排除申請之前就已存在的那些 token**：
 * 連跑兩次本套件時，`waitForMail` 只認第一封符合條件的信，
 * 而那一封的 token 已被這次申請作廢 —— 稽核到的又會是「連結已失效」。
 */
let resetToken: string;

beforeAll(async () => {
  readerCookie = await loginAs('reader@novelsite.tw', SEED_PASSWORD, '10.50.1.1');
  authorCookie = await loginAs('author@novelsite.tw', SEED_PASSWORD, '10.50.1.2');

  // novelId／chapterId 自公開頁面的 HTTP 回應解析，MUST NOT 經 repository（a11y 套件限制）
  const novelsHtml = await fetch(`${baseUrl()}/novels`).then((r) => r.text());
  const candidateIds = [...novelsHtml.matchAll(/\/novels\/([a-zA-Z0-9_-]+)/g)].map((m) => m[1]);

  for (const id of candidateIds) {
    const detailRes = await fetch(`${baseUrl()}/novels/${id}`);
    if (detailRes.status !== 200) continue;
    const detailHtml = await detailRes.text();
    // 兩個群組必須來自同一個 /reader/ 連結（novelId、chapterId 一起擷取）——
    // 頁面上可能出現其他作品的連結（如相關作品），只抓 chapterId 卻沿用外層迴圈的 id
    // 會兜出不成對的組合而 404。
    const chapterMatch = detailHtml.match(/\/reader\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_-]+)/);
    if (!chapterMatch) continue;

    // 「立即閱讀」連結是依 firstChapterId 無條件渲染，示範資料中至少一部作品的
    // volumes 為空但 firstChapterId 仍指向不存在的章節（內容資料一致性問題，屬 FEAT-2
    // 範圍，非本階段修正對象）—— 故仍須實際驗證該連結能 200，避免挑到壞掉的作品。
    const readerCandidatePath = `/reader/${chapterMatch[1]}/${chapterMatch[2]}`;
    const readerCandidateRes = await fetch(`${baseUrl()}${readerCandidatePath}`);
    if (readerCandidateRes.status !== 200) continue;

    novelId = chapterMatch[1];
    readerChapterId = chapterMatch[2];
    break;
  }

  if (!novelId || !readerChapterId) {
    throw new Error('無法從 /novels 公開頁面解析出可用的 novelId／chapterId');
  }

  // ── 以真實 Action 建立「作者本人的」作品 → 卷 → 章節（供三個作者頁面稽核） ──
  const categoriesHtml = await fetch(`${baseUrl()}/categories`).then((r) => r.text());
  const categoryId = categoriesHtml.match(/\/categories\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!categoryId) throw new Error('無法自 /categories 解析出 categoryId');

  await callAction(
    'createNovelAction',
    [{ title: 'a11y 稽核用作品', categoryId, excerpt: '由 a11y 測試建立，用於稽核作品管理頁。' }],
    { ip: '10.50.1.2', cookie: authorCookie }
  );

  // 作品識別碼自作品列表頁解析 —— 順帶驗證 T053 的「作品項目連至作品管理頁」確實存在
  const worksHtml = await fetch(`${baseUrl()}/author/novels`, {
    headers: { Cookie: authorCookie, 'X-Forwarded-For': '10.50.1.2' },
  }).then((r) => r.text());
  const parsedNovelId = worksHtml.match(/\/author\/novels\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!parsedNovelId) throw new Error('作品列表頁沒有指向作品管理頁的連結');
  authorNovelId = parsedNovelId;

  const managePath = `/author/novels/${authorNovelId}`;
  const volumeRes = await callAction(
    'createVolumeAction',
    [{ novelId: authorNovelId, title: '第一卷' }],
    { ip: '10.50.1.2', cookie: authorCookie, route: managePath }
  );
  const volumeId = volumeRes.text.match(/"volumeId":"([a-zA-Z0-9_-]+)"/)?.[1];
  if (!volumeId) throw new Error(`建立卷失敗：${volumeRes.text.slice(0, 300)}`);

  await callAction('createChapterAction', [{ novelId: authorNovelId, volumeId }], {
    ip: '10.50.1.2',
    cookie: authorCookie,
    route: managePath,
  });

  // 章節識別碼自作品管理頁解析（該頁的章節列表連向編輯器）
  const manageHtml = await fetch(`${baseUrl()}${managePath}`, {
    headers: { Cookie: authorCookie, 'X-Forwarded-For': '10.50.1.2' },
  }).then((r) => r.text());
  const parsedChapterId = manageHtml.match(/\/author\/editor\/([a-zA-Z0-9_-]+)/)?.[1];
  if (!parsedChapterId) throw new Error('作品管理頁沒有指向章節編輯器的連結');
  authorChapterId = parsedChapterId;

  // ── 申請一次密碼重設，取回真 token（供 /auth/reset-password 稽核，T038）──
  const isResetMailTo = (to: string) => to.toLowerCase() === 'reader@novelsite.tw';
  const staleTokens = new Set(
    (await readOutbox()).filter((e) => isResetMailTo(e.to)).map((e) => extractResetToken(e.text))
  );

  const requestRes = await testFetch('/api/auth/password-reset/request', {
    method: 'POST',
    ip: '10.50.1.3',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'reader@novelsite.tw' }),
  });
  if (requestRes.status !== 200) {
    throw new Error(`申請密碼重設失敗：狀態碼 ${requestRes.status}`);
  }

  // 寄送在回應之後（`after()`，FR-006a），故必須輪詢而非直接讀
  const mail = await waitForMail(
    (entry) => isResetMailTo(entry.to) && !staleTokens.has(extractResetToken(entry.text))
  );
  resetToken = extractResetToken(mail.text);
});

async function expectZeroViolations(path: string, cookie?: string) {
  const results = await auditPage(path, cookie ? { cookie } : undefined);
  expect(results.violations).toEqual([]);
}

describe('a11y 頁面層：公開頁面（不帶 cookie）', () => {
  it('/auth/login', async () => {
    await expectZeroViolations('/auth/login');
  });

  it('/auth/register', async () => {
    await expectZeroViolations('/auth/register');
  });

  it('/contact', async () => {
    await expectZeroViolations('/contact');
  });

  /** 忘記密碼（FEAT-5 T034／T038）：新增頁面，Email 欄位與一律相同的送出後提示皆為新控制項 */
  it('/auth/forgot-password（申請重設，T034）', async () => {
    await expectZeroViolations('/auth/forgot-password');
  });

  /**
   * 設定新密碼（FEAT-5 T035／T038）。**帶真 token** —— 見 `resetToken` 的說明：
   * 假 token 渲染的是「連結已失效」，那個畫面照樣可能零違規。
   *
   * 故一併斷言表單**真的被渲染**（比照下方空狀態那一節的做法）：
   * 少了這一句，token 哪天失效時這一則會安靜地改成稽核一個錯誤畫面，
   * 而測試名稱仍寫著「設定新密碼表單」。
   */
  it('/auth/reset-password（設定新密碼表單，T035）', async () => {
    const results = await auditPage(`/auth/reset-password?token=${resetToken}`);
    expect(results.violations).toEqual([]);
    expect(
      document.body.textContent ?? '',
      '重設頁沒有渲染新密碼表單 —— 稽核到的是「連結已失效」而不是要驗的那個畫面'
    ).toContain('至少 8 個字元');
  });

  /**
   * 隱私政策（FEAT-5 T041／T042）：§四新增了直接列出的 `mailto:` 連結。
   * **`/contact` 已在上方清單內，`/privacy` 則從未被稽核過** —— 而本階段動的是它。
   */
  it('/privacy（個資權利行使段落的 mailto: 位址，T041）', async () => {
    await expectZeroViolations('/privacy');
  });

  it('/novels/{novelId}（加入書架「僅存本機」加註，T084）', async () => {
    await expectZeroViolations(`/novels/${novelId}`);
  });

  it('/reader/{novelId}/{chapterId}（閱讀偏好面板「僅存本機」加註，T084）', async () => {
    await expectZeroViolations(`/reader/${novelId}/${readerChapterId}`);
  });

  /**
   * 搜尋頁（FEAT-3 T076）：combobox 的輸入框、建議清單容器與分類篩選皆為新增控制項。
   * **帶關鍵字**而非空白頁 —— 空白頁不會渲染結果區與「載入更多」，
   * 稽核一個什麼都沒有的畫面等於沒有稽核。
   * 建議清單本身的鍵盤與 `aria-activedescendant` 行為另由
   * `tests/a11y/search-suggest.test.tsx` 在互動狀態下驗證（頁面層稽核只看到初始狀態）。
   */
  it('/search（即時建議 combobox 與分類篩選，T071–T073）', async () => {
    await expectZeroViolations(`/search?q=${encodeURIComponent('劍')}`);
  });
});

describe('a11y 頁面層：需一般讀者登入', () => {
  it('/profile/settings', async () => {
    await expectZeroViolations('/profile/settings', readerCookie);
  });

  it('/profile/bookshelf', async () => {
    await expectZeroViolations('/profile/bookshelf', readerCookie);
  });

  it('/profile/history', async () => {
    await expectZeroViolations('/profile/history', readerCookie);
  });

  /** 通知中心（FEAT-4 4-D / T138、T153）：新增頁面，清單、未讀篩選與標記已讀皆為新控制項 */
  it('/profile/notifications（通知中心，T138）', async () => {
    await expectZeroViolations('/profile/notifications', readerCookie);
  });
});

describe('a11y 頁面層：需作者登入', () => {
  it('/author/dashboard', async () => {
    await expectZeroViolations('/author/dashboard', authorCookie);
  });

  it('/author/novels（作品列表接上真實擁有者與管理頁連結，T053）', async () => {
    await expectZeroViolations('/author/novels', authorCookie);
  });

  it('/author/earn（示範資料標示，T082a）', async () => {
    await expectZeroViolations('/author/earn', authorCookie);
  });

  it('/author/create（建立作品表單接上真實 Action，T045）', async () => {
    await expectZeroViolations('/author/create', authorCookie);
  });

  it('/author/editor/{chapterId}（儲存／發佈／下架接上真實 Action，T052）', async () => {
    await expectZeroViolations(`/author/editor/${authorChapterId}`, authorCookie);
  });

  it('/author/novels/{novelId}（作品管理頁：資訊、分卷、章節排序、上下架與刪除，T046–T051）', async () => {
    await expectZeroViolations(`/author/novels/${authorNovelId}`, authorCookie);
  });

  /** 作者留言管理（FEAT-4 4-B / T080、T153）：新增頁面，隱藏／取消隱藏為新控制項 */
  it('/author/comments（留言管理，T080）', async () => {
    await expectZeroViolations('/author/comments', authorCookie);
  });
});

/**
 * 反向驗證（T098、SC-007）：把登入 Cookie 拿掉之後，上面每一則受保護頁面的稽核
 * **MUST 失敗**。
 *
 * 少了這一節，「受保護頁面零違規」這句話可能只是「登入頁零違規」——
 * 未帶憑證時伺服器回的是 302 或登入頁 HTML，而登入頁本來就很乾淨。
 * 恆綠而什麼都沒驗到的測試，比沒有測試更糟：它會讓人相信已經驗過了。
 *
 * 逐頁列舉而非只抽驗一頁：本階段新增的三個作者頁與個人設定頁各自有不同的守衛路徑
 * （proxy matcher、`requireAuthor()`、`requireUser()`、擁有者條件），
 * 只驗其中一條證明不了其餘幾條。
 */
describe('a11y 反向驗證：未帶憑證存取受保護頁面 MUST 失敗（T098、SC-007）', () => {
  it('列舉的受保護頁面在移除 Cookie 後全數擲錯', async () => {
    const protectedPaths = [
      '/profile/settings',
      '/profile/bookshelf',
      '/profile/history',
      '/author/dashboard',
      '/author/novels',
      '/author/earn',
      '/author/create',
      `/author/editor/${authorChapterId}`,
      `/author/novels/${authorNovelId}`,
      // FEAT-4 T153 新增的兩頁：各自走不同的守衛（requireUser／requireAuthor）
      '/profile/notifications',
      '/author/comments',
    ];

    for (const path of protectedPaths) {
      await expect(auditPage(path), `${path} 未帶憑證卻回了 200`).rejects.toThrow();
    }
  });

  it('公開頁面在同樣不帶 Cookie 時 MUST 成功（證明擲錯來自守衛，不是 auditPage 壞了）', async () => {
    await expect(auditPage('/auth/login')).resolves.toBeDefined();
  });
});

/**
 * FR-043b 的**八個空狀態**（FEAT-4 T153）
 * ========================================
 * 空狀態在本專案裡不是邊角情境，而是**示範環境的主要路徑**：FR-043a 刪掉了全部造假
 * 資料來源之後，全站計數自零起算，讀者看到的第一眼就是這八個畫面。
 *
 * 每一則同時驗兩件事：
 *   1. axe 違規數為 0
 *   2. 空狀態文案**真的出現在該頁的回應裡**
 *
 * 少了第 2 點，這一節會在「資料不小心有了」的那天默默改成稽核有資料的畫面，
 * 而測試名稱仍寫著空狀態 —— 一個名實不符的綠燈比沒有測試更難發現。
 * `auditPage()` 會把抓到的 HTML 灌進 jsdom 的 global document，故稽核後
 * 直接讀 `document.body.textContent` 即為該頁的實際內容（見 axeHelper.ts）。
 */
describe('a11y 空狀態：FR-043b 的八個空畫面（T153）', () => {
  async function expectEmptyStateAudit(path: string, copy: string, cookie?: string) {
    const results = await auditPage(path, cookie ? { cookie } : undefined);
    expect(results.violations, `${path} 的空狀態有 a11y 違規`).toEqual([]);
    expect(
      document.body.textContent ?? '',
      `${path} 沒有渲染空狀態文案「${copy}」——這一則稽核的其實不是空狀態`
    ).toContain(copy);
  }

  it('1. 作品詳情頁的評論區', async () => {
    await expectEmptyStateAudit(`/novels/${novelId}`, '還沒有人評論這部作品');
  });

  it('2. 排行榜頁', async () => {
    await expectEmptyStateAudit('/ranking', '此榜單目前尚無上榜作品');
  });

  it('3. 首頁的排行區塊', async () => {
    await expectEmptyStateAudit('/', '尚未產生本週排行');
  });

  it('4. 作者儀表板的趨勢圖', async () => {
    await expectEmptyStateAudit(
      '/author/dashboard',
      '這裡會顯示近 14 天的每日瀏覽趨勢',
      authorCookie
    );
  });

  it('5. 作品成效頁的比率指標（分母為 0 MUST 顯示「尚無資料」而非 0%）', async () => {
    await expectEmptyStateAudit('/author/earn', '尚無資料', authorCookie);
  });

  it('6. 通知中心', async () => {
    await expectEmptyStateAudit('/profile/notifications', '還沒有任何通知', readerCookie);
  });

  it('7. 書架', async () => {
    await expectEmptyStateAudit('/profile/bookshelf', '書架目前是空的', readerCookie);
  });

  it('8. 閱讀歷史', async () => {
    await expectEmptyStateAudit('/profile/history', '還沒有任何閱讀紀錄', readerCookie);
  });
});
