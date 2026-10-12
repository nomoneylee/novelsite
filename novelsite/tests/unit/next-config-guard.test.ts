import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import nextConfig from '../../next.config';

/**
 * `next.config.ts` MUST NOT 設定 `experimental.serverActions.bodySizeLimit`（FEAT-7 T047、research R-1）
 * ======================================================================================================
 * 批次匯入走 Route Handler 而不走 Server Action，**就是為了不動這個設定**：
 * 它是全域的，為匯入調高等於把站上每一個 Server Action 都變成 50 MB 的入口。
 *
 * 這條規則的價值全在「持續成立」—— 日後有人為了別的理由（大圖上傳、長表單）調高它，
 * 匯入路徑不會有任何症狀，而全站的攻擊面已經變了。故以測試而非註解守住。
 *
 * **兩面各鎖一次**：
 *   (a) 匯入設定物件本身斷言該鍵不存在 —— 這是語意上正確的判準；
 *   (b) 掃原始碼字面量 —— 有人改以別的寫法（展開、條件式、環境變數）注入時，
 *       (a) 在本機 `process.env` 沒設的情況下仍會是 undefined，而部署環境會設。
 */

type ExperimentalServerActions = { serverActions?: { bodySizeLimit?: unknown } };

describe('T047 next.config.ts 的 serverActions.bodySizeLimit 未被設定（research R-1）', () => {
  it('設定物件中不存在 experimental.serverActions.bodySizeLimit', () => {
    const experimental = nextConfig.experimental as ExperimentalServerActions | undefined;
    expect(experimental?.serverActions?.bodySizeLimit).toBeUndefined();
  });

  it('原始碼中不出現 bodySizeLimit 字面量', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../next.config.ts'), 'utf8');
    expect(source).not.toContain('bodySizeLimit');
  });
});
