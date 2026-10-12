import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Skill scripts (CommonJS, not part of Next.js app)
    '.agents/**',
    // Playwright 產物（FEAT-4 T157）：`html` reporter 會把整個追蹤檢視器的
    // 打包後 JS 落地到工作目錄。那是別人的建置產物，不是我們寫的程式碼 ——
    // 不排除的話 `npm run lint` 會被兩百多筆來自壓縮碼的錯誤淹沒，
    // 綠燈閘門形同失效。兩者皆已在 .gitignore 內，不會進版控。
    'test-results/**',
    'playwright-report/**',
  ]),
  {
    // FR-018：`rehype-raw` 一律禁止 import。
    //
    // 這條規則是 M-2 的**防漂移閘門**，不是風格偏好。`SafeMarkdown` 之所以安全，
    // 唯一的理由是它沒有把原始 HTML 交給瀏覽器；而讓它變得不安全只需要一行 import
    // ——那一行在 code review 裡看起來完全無害（「加個外掛支援表格排版」），
    // 但它會讓全站每一段作者輸入的正文重新變成可執行的 HTML。
    //
    // 規則放在 lint 而非文件裡，是因為文件擋不住任何東西：綠燈閘門會擋。
    files: ['**/*.{ts,tsx,js,jsx,mjs}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'rehype-raw',
              message:
                '禁止引入 rehype-raw（FR-018）：它會把作者輸入的原始 HTML 還原成真正的節點，' +
                '使 SafeMarkdown 的淨化失效。需要新的排版能力請改用 remark 外掛，' +
                '或於 SafeMarkdown 內以白名單擴充 rehype-sanitize 的 schema。',
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
