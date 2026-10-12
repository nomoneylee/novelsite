/**
 * FEAT-5 T014a：FR-004 的兩條 MUST NOT（`/speckit-analyze` U2）
 * ============================================================
 * 在此之前 FR-004 只有實作（`log.ts`）沒有把關。它守的兩件事在畫面上都看不見：
 *
 * 1. 寄送記錄**不含正文、不含 `token=`、不含憑證明碼** —— 一旦漏出，
 *    伺服器記錄本身就成了一條「任何人只要讀得到 log 就能改別人密碼」的路徑，
 *    而記錄是站上少數會被整段貼進 issue 的輸出。
 * 2. `MAIL_MODE=production` 下 `ConsoleMailer` **不被建構** —— 它會把重設連結全文印出來。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logMailAttempt } from '@/lib/mail/log';
import { createMailer } from '@/lib/mail';
import { ConsoleMailer } from '@/lib/mail/consoleMailer';
import type { MailMessage } from '@/lib/mail/types';

const RESET_TOKEN = 'jH8_xQ2kLm4NpR7sT0vW9yZbCdEfGhIjKlMnOpQrStU';
const API_KEY = 're_super_secret_api_key';

/** 一封「什麼都不該外洩的東西全在裡面」的信 */
const MESSAGE: MailMessage = {
  to: 'reader@novelsite.tw',
  subject: '重設你的 NovelSite 密碼',
  text: [
    '你好，',
    `請點擊以下連結重設密碼：https://novelsite.tw/auth/reset-password?token=${RESET_TOKEN}`,
    '此連結 30 分鐘內有效。若非本人申請可忽略本信，你的密碼不會有任何變動。',
    `（測試用的假憑證，順帶確認它不會被帶進記錄：${API_KEY}）`,
  ].join('\n'),
};

function captureLog(fn: () => void): string {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    fn();
    return spy.mock.calls.map((args) => args.map(String).join(' ')).join('\n');
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logMailAttempt：寄送記錄 MUST NOT 含正文、連結或憑證（FR-004）', () => {
  it('輸出不含正文、不含 token=、不含憑證明碼', () => {
    const output = captureLog(() =>
      logMailAttempt({ mode: 'memory', message: MESSAGE, result: 'sent' })
    );

    expect(output).not.toContain('token=');
    expect(output).not.toContain(RESET_TOKEN);
    expect(output).not.toContain(API_KEY);
    expect(output).not.toContain('若非本人申請');
    expect(output).not.toContain(MESSAGE.text);
  });

  it('輸出不含收件人明碼，但含其雜湊前 8 碼（同一收件人的多次嘗試仍可被串起來）', () => {
    const output = captureLog(() =>
      logMailAttempt({ mode: 'memory', message: MESSAGE, result: 'sent' })
    );

    expect(output).not.toContain(MESSAGE.to);
    // sha256('reader@novelsite.tw') 的前 8 碼
    expect(output).toMatch(/to=[0-9a-f]{8}\b/);
  });

  it('輸出含 mode 與結果；失敗時另含錯誤碼（記錄要能回答「為什麼沒收到信」）', () => {
    const sent = captureLog(() =>
      logMailAttempt({ mode: 'production', message: MESSAGE, result: 'sent' })
    );
    expect(sent).toContain('mode=production');
    expect(sent).toContain('sent');

    const failed = captureLog(() =>
      logMailAttempt({
        mode: 'production',
        message: MESSAGE,
        result: 'failed',
        errorCode: 'HTTP_422',
      })
    );
    expect(failed).toContain('failed');
    expect(failed).toContain('code=HTTP_422');
  });
});

describe('MAIL_MODE=production 下 ConsoleMailer 不被建構（FR-004 末句）', () => {
  it('createMailer("production") 不是 ConsoleMailer', () => {
    expect(createMailer('production')).not.toBeInstanceOf(ConsoleMailer);
  });

  /**
   * 「不是 ConsoleMailer」單獨看是弱斷言：`createMailer` 若回一個空物件也會通過。
   * 補一則正向確認 —— console 模式**確實**選得到它，上面那則才有意義。
   */
  it('console 模式確實選得到 ConsoleMailer（上一則不得靠「哪個都不是」而恆綠）', () => {
    expect(createMailer('console')).toBeInstanceOf(ConsoleMailer);
  });
});
