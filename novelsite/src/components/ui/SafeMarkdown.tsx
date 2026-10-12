import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

/**
 * 全站**唯一**的 Markdown 渲染路徑（FR-017／FR-018、nextstep.md M-2）
 * ====================================================================
 * 消費者只有兩處：讀者端正文（`ReaderView`）與編輯器預覽（`ChapterEditor`）。
 * 兩處共用同一個元件是刻意的 —— 作者在預覽看到的、與讀者實際讀到的，
 * 若走的是兩條渲染路徑，「預覽沒問題」就再也不代表「發佈出去沒問題」。
 *
 * **本元件沒有任何可放寬淨化的 prop，這一點不可協商**：
 *
 * - 不引入 `rehype-raw`。憲章技術約束明文「MUST NOT 啟用 `rehype-raw`；若確有需要
 *   MUST 同時導入 `rehype-sanitize`」——本專案的作法比條款更嚴：**兩者只導入後者**。
 *   `eslint.config.mjs` 的 `no-restricted-imports` 會在閘門擋下任何重新引入的嘗試（FR-018）。
 * - 不開放 `components` 覆寫、不開放自訂 `rehypePlugins`。多一個可設定的入口，
 *   就多一個「某天某個需求把它調寬、而且沒有人記得為什麼原本是窄的」的機會。
 *
 * 淨化採 `rehype-sanitize` 的**預設 schema**（GitHub 的 sanitation 規則）：
 * 標籤白名單、屬性白名單、`javascript:` 之類的協定一律剔除。
 * 作者寫的原始 HTML 不會消失，會以純文字呈現 —— 內容不被吃掉，但也不會被執行。
 */
export function SafeMarkdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export default SafeMarkdown;
