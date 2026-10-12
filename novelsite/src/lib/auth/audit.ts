export interface SecurityEvent {
  event: string;
  ip: string;
  result: string;
}

/**
 * 輸出單行 JSON 到標準輸出，固定四個欄位（事件類型、時間、來源位址、結果）。
 * MUST NOT 含密碼或憑證原文；MUST NOT 建立資料庫稽核表（FR-010）。
 * 實作上只擷取 event/ip/result 三個已知欄位組出新物件 —— 呼叫端即使誤傳額外欄位
 * （如密碼），也不會被本函式帶入輸出。
 */
export function logSecurityEvent(e: SecurityEvent): void {
  const record = {
    event: e.event,
    at: new Date().toISOString(),
    ip: e.ip,
    result: e.result,
  };
  console.log(JSON.stringify(record));
}
