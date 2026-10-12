# 待人工執行的工作清單（2026-08-11）

> ## ⚠️ 2026-08-15：人工項目的真相來源已移至 `deploy/deployment.md` §6
>
> **上線前置作業的完整清單是 [`deploy/deployment.md`](../deploy/deployment.md) §6 的 A／B 兩區**
> （A 區 19 項一次性前置設定、B 區 11 項每次／不定期項目，每項都附「沒做會怎樣」）。
> **本檔 MUST NOT 被當成第二份人工清單**——兩份清單並存等於沒有真相來源，
> 而兩者漂移之後，讀的人只會照著先找到的那一份做。
>
> **本檔自本日起只剩一個用途**：FEAT-5 郵件三項（帳號／寄件網域／SPF-DKIM-DMARC）的
> **逐步操作說明與實收驗收紀錄**——那是 `deploy/deployment.md` A 區沒有展開的操作細節。
> 凡本檔與 `deploy/deployment.md` §6 有出入之處，**一律以 §6 為準**。
>
> 已被 FEAT-6 消滅、**MUST NOT 再執行**的項目（見 §6.1 的排除表）：
> 建立 6 筆參考分類（改由 migration）、設定主機 crontab（改由 `cron` 容器）、
> 建立／登入映像庫（映像於正式主機原生建置）。
>
> D 階段（部署）的步驟同樣以 `deploy/deployment.md` §3、§6 與「回滾」章節為準：
> 部署已改為**合併進 `main` 即自動執行**，本檔 D 階段描述的手動部署動作已不是常態路徑。

> **這份檔案是「操作順序」的彙整，不是新的真相來源。**
> 每一項的判準與理由仍以 `README.md`（待外部條件、已知限制）、`arch.md` §9 Phase 13／14、
> `features.md` FEAT-4／FEAT-5 與 `deploy/deployment.md` 為準；本檔只回答「先做哪一件、怎麼做、
> 做完怎麼確認」。若兩邊有出入，**以那四份為準並回頭修正本檔**。

**為什麼需要這份清單**：程式碼已完成的功能，與「使用者真的收得到信」之間隔著一組
**只能由人操作的外部條件**（帳號、網域、DNS）。這段落差最危險的地方在於——
缺了它們，站台**照樣回報「已寄出」**、聯絡表單**照樣顯示成功**，畫面上完全看不出問題。
所以本檔每一階段的驗收都以「**實際收到信**」為準，
**MUST NOT 以「系統回報成功」充當送達**（`arch.md` Phase 14 第 8 項）。

## 先回答最重要的一件事：本機測試需要做幾項？

**零項。本機測試所需的人工工作已全部完成，且從頭到尾不需要任何外部帳號。**

這是 **SC-014** 刻意設計的結果：本機以 `MAIL_MODE=console` 執行，重設連結（含完整網址與憑證）
直接印在跑 `npm run dev` 的那個終端機上，因此「申請 → 取連結 → 設新密碼 → 以新密碼登入」
全程在本機走得完，**不需要 Resend、不需要網域、不需要任何一筆 DNS**。

下表是**唯一**與本機有關的三項，皆已完成：

| # | 本機測試前置 | 狀態 | 完成日 |
| --- | --- | --- | --- |
| L1 | `novelsite/.env` 補齊 `DATABASE_URL`／`SESSION_SECRET`／`VIEW_HASH_SECRET`（缺這三項 `npm run build` 會以「環境變數驗證失敗」中止，屬 FR-049 的預期行為） | ✅ | 2026-08-11 |
| L2 | `npx playwright install firefox webkit`（`test:e2e` 的一次性二進位下載，**是前置安裝步驟、不是待外部條件**） | ✅ | 2026-08-11 |
| L3 | 以 `MAIL_MODE=console` 在本機走完密碼重設全程（`tasks.md` T039，SC-014） | ✅ | 2026-08-10 |

> **換一台機器 clone 之後**：照 `README.md`「快速開始」跑 `npm install` → 建 `.env` → `db:migrate`
> → `db:seed` → `dev` 即可，郵件部分只需 `.env` 加一行 `MAIL_MODE=console`。**仍然零外部帳號。**

**下面 A～G 共 27 項，全部是「正式上線前」才需要的**，本機測試一項都用不到。
（原為 28 項；**A2「改 name server」已於 2026-08-16 裁示為不適用**，理由見 A 節。）

> **第 0 階段已於 2026-08-15 完成，原文已失效並取代**：原文寫「程式碼目前還不支援子路徑，
> 五項會壞……擋在 D 階段之前」。五項已於 FEAT-6 全數修畢並由 `npm run test:basepath` 固定
> （見 `deploy/deployment.md` §9），**它不再擋住任何操作**。

## 目前狀態一覽

| 階段 | 內容 | 🏠 本機可做 | 🚀 需正式機 | 狀態 |
| --- | --- | --- | --- | --- |
| **0** | **程式碼支援路徑前綴**（[issue #9](https://github.com/nomoneylee/novels/issues/9)、`deploy/deployment.md` §9 的五項）—— 2026-08-11 新增，**這是寫程式不是操作**，故不計入下方 28 項 | 5（全部） | 0 | ✅ 已完成（2026-08-15，FEAT-6） |
| A | 網域與 DNS | 1（A1 於 Cloudflare Registrar 買網域）；**A2 改 name server 已不適用**（2026-08-16 裁示，見 A 節） | 1（A3；其前提「機器要有固定 IP」已於 2026-08-16 完成） | ⬜ 未開始 |
| B | Resend 帳號、寄件網域驗證、SPF／DKIM／DMARC | **6（全部）** | 0 | ⬜ 未開始 |
| C | 站台專用聯絡信箱（換掉過渡用的個人 Gmail） | **2（全部）** | 0 | ⬜ 未開始 |
| D | 正式環境設定與部署 | 0 | 3 | ⬜ 未開始 |
| E | 郵件三項實收驗收（SC-001／SC-006／SC-007） | 1（E4 認證檢查） | 4 | ⬜ 未開始 |
| F | FEAT-4 遺留的三項待外部條件 | 0 | 3 | ⬜ 未開始 |
| G | 完成後的文件回寫（憲章要求） | **6（全部）** | 0 | ⬜ 未開始 |
| | **合計 27 項**（原 28 項，A2 於 2026-08-16 裁示為不適用） | **16** | **11** | |

**先做 🏠 那 16 項**：A1 + B 全部 + C 全部，就能在**還沒有任何伺服器**的情況下
把「信到底寄不寄得出去、認證過不過」整組驗完（見 E 節開頭）。
剩下 11 項全部卡在「要有一台跑著的正式機」，是同一個前提。

**逐項標記（A～G 每一項都是「上線前必做」，差別只在做得動的地點）**：

- **🏠** = 上線前必做，但**本機／瀏覽器就能做完並驗證**，不必等部署。
- **🚀** = 上線前必做，且**必須有正式機、公開網址或實體裝置**，本機做不到。

**🏠 不等於「本機測試需要它」**——本機測試需要的是上面那三項 L1～L3，且都已完成。
🏠 的意思是「這件上線前的工作，你現在就可以先做掉，省一次部署來回」。

**階段之間是硬相依**：B 需要 A 的網域、D 需要 B 的 API 金鑰、E 的公開網址部分需要 D 已部署。
唯一完全獨立的是 **C**（只要有網域就能建信箱）。

---

## A. 網域與 DNS

> 出處：`deploy/deployment.md` §2、§5。**這一階段是其餘全部的前提** —— 沒有自己控制得了 DNS 的網域，
> 就無法驗證寄件網域，也就沒有 SPF／DKIM／DMARC 可加。

- [ ] 🏠 **A1. 於 Cloudflare Registrar 直接購買網域，下單前先確認該 TLD 有支援**
      *使用者裁示（2026-08-16）*：**網域直接在 Cloudflare 買**（判準、附帶限制與完整理由
      以 `deploy/deployment.md` §2、§2.1 為準）。原文「先確認 TLD 支援，再下單」的**順序要求仍然成立**，
      作法改為：**下單前 MUST 於 Cloudflare 實際搜尋一次該網域**，搜得到才算支援。
      **`.tw`／`.com.tw` 不在 Cloudflare Registrar 的支援清單內**；若最終仍要 `.tw`，
      本項與 A2 一併退回 `deploy/deployment.md` §2 上表第二列的兩段式流程
      （他家 TWNIC 認證註冊商購買 → 再把 name server 改到 Cloudflare）。
- [x] 🏠 **~~A2. 把網域的 DNS 交給 Cloudflare 託管~~ ——不適用（2026-08-16）**
      **原文已失效並取代**：「在 Cloudflare 新增站點 → 把註冊商的 name server 改成 Cloudflare
      給的兩筆 → 等生效」**只適用於非 Cloudflare 註冊商**。A1 既已裁示於 Cloudflare Registrar
      下單，**DNS 自下單起即由 Cloudflare 代管，沒有 name server 可改，也沒有生效等待**。
      留著它的代價不是多做一次工，而是操作者會去後台找一個不存在的設定。
      （若 A1 因 TLD 不支援而退回兩段式流程，本項隨之復活。）
- [ ] 🚀 **A3. 建立指向站台的 A 記錄，並維持「灰雲」（DNS-only）**
      `deploy/deployment.md` §5：建議先以灰雲上線，架構單純；日後要防護再切橘雲。
      **切換橘雲時 MUST 同時把 `TRUSTED_PROXY_HOPS` 由 `1` 改為 `2`** —— 那一列是切換時最常漏的，
      漏了會讓登入限流變成全站共用一個額度。

**A3 的前提已滿足（2026-08-16）**：Oracle Cloud 執行個體已建立，且公用 IP 已改為
**Reserved Public IP**（`deploy/deployment.md` §3.1、§6.1 A1／A2），故網域一買下來即可立刻建 A 記錄。

**驗收**：`dig 你的網域` 或 Cloudflare 後台顯示記錄已生效；此時你**有能力新增 TXT 記錄**（B 階段要用）。

---

## B. Resend 帳號、寄件網域與三筆 DNS 記錄

> 出處：`README.md`「待外部條件（FEAT-5）」、`arch.md` §9 Phase 14 第 8 項。
> **本階段的第三項（DMARC）是整個 FEAT-5 最容易被誤判為完成的一項。**

- [ ] 🏠 **B1. 註冊 Resend 帳號**（<https://resend.com>）
      免費方案即可先行驗證；本專案**不引入 `resend` SDK**，只以 `fetch` 直呼
      `POST https://api.resend.com/emails`（`arch.md` Phase 14 第 1 項），故不需要安裝任何東西。
- [ ] 🏠 **B2. 在 Resend 後台新增寄件網域**
      Domains → Add Domain → 填入 A 階段的網域（Resend 會建議用子網域，例如 `send.你的網域`）。
      加完後畫面會列出**要你貼到 DNS 的記錄**（SPF 用的 TXT、DKIM 用的 TXT，視設定另有 MX）。
- [ ] 🏠 **B3. 把 B2 列出的記錄逐筆加到 Cloudflare**
      **逐字複製，MUST NOT 自行改寫或補上引號** —— TXT 值多一個空白或引號就驗不過，
      而 Resend 只會顯示「未驗證」，不會告訴你是哪個字元。
      這些記錄**MUST 維持灰雲／DNS-only**（TXT 本來就不能代理，但 MX 若有請確認）。
- [ ] 🏠 **B4. 回 Resend 按驗證，等狀態變為 Verified**
      DNS 傳播可能需要數分鐘到一小時。**未 Verified 之前不要進行 D 階段** ——
      站台會啟動成功、寄送 API 也可能回 2xx，但信收不到。
- [ ] 🏠 **B5. 自行新增 DMARC 記錄（Resend 不會給你這一筆）**
      在 Cloudflare 新增 TXT 記錄，名稱 `_dmarc`，值先用觀察模式：

      ```
      v=DMARC1; p=none; rua=mailto:你的收件信箱
      ```

      `p=none` 表示「只回報、不處置」，先跑一到兩週確認自家信件都通過認證，
      再視情況收緊為 `p=quarantine` 或 `p=reject`。
      **一上來就 `p=reject` 的風險**：任何一筆設定沒對齊，信會被收件方直接丟棄且你不會收到退信。
- [ ] 🏠 **B6. 建立 API 金鑰**
      API Keys → Create API Key，權限取「僅寄送」即可。
      **金鑰只會完整顯示一次**，當下就存進密碼管理工具。
      **MUST NOT 提交進版控**（`.env` 已被 `.gitignore` 忽略；`.env.test` 明文禁止放任何憑證）。

**驗收**：Resend 後台網域狀態為 **Verified**，且 `dig TXT _dmarc.你的網域` 查得到 B5 那一筆。

---

## C. 站台專用聯絡信箱

> 出處：`features.md` FEAT-5 風險表最後一列。
> 目前的預設值 `contact@example.com` 是**佔位值**（原為開發者個人信箱，2026-10-12 公開 repo 前改掉，避免個人信箱隨原始碼公開），
> 它會被公開印在隱私權頁上，正式上線 MUST 以 `CONTACT_EMAIL` 換為站台專用位址。

- [ ] 🏠 **C1. 建立 `contact@你的網域`**
      最省事的作法是用 Cloudflare Email Routing（免費）把它轉寄到你現有的信箱：
      Cloudflare → Email → Email Routing → 建立轉寄規則，並加上它要求的 MX 與 TXT 記錄。
- [ ] 🏠 **C2. 從外部信箱寄一封測試信到 `contact@你的網域`，確認轉寄真的到得了**
      這一步就是 E 階段 SC-007 的前置；**這裡收不到，E 階段一定失敗**。

---

## D. 正式環境設定與部署

> 出處：`deploy/deployment.md` §3.4、§4；環境變數說明見 `README.md`「環境變數」。

- [ ] 🚀 **D1. 在正式機的 `novelsite/.env` 補上五個郵件相關的值**

      ```dotenv
      MAIL_MODE=production
      RESEND_API_KEY=re_…                      # B6 取得
      MAIL_FROM="NovelSite <noreply@你的網域>"   # 網域須為 B4 已 Verified 的那一個
      CONTACT_EMAIL=contact@你的網域             # C1 建立的位址
      NEXT_PUBLIC_SITE_URL=https://你的網域/novelsite   # MUST 明示，且 MUST 含路徑前綴
      CRON_BASE_URL=http://localhost:3000/novelsite    # 同樣 MUST 含前綴
      ```

      **`NEXT_PUBLIC_SITE_URL` 未明示會直接拒絕啟動**（`MAIL_MODE=production` 下）：
      重設連結是絕對網址，沿用回落值等於每一封信的連結都指向別的網站，而系統仍回報「已寄出」。
      **多站架構下漏掉 `/novelsite` 這一段的症狀一樣惡劣**：連結指向網域根目錄，
      而那裡是另一個站 —— 使用者點下去看到別人的網站，而信「確實寄出了」。
      其餘既有變數（`SESSION_SECRET`、`VIEW_HASH_SECRET`、`TRUSTED_PROXY_HOPS=1` 等）見 `deploy/deployment.md` §4。

- [ ] 🚀 **D2. 依 `deploy/deployment.md` §3.4 部署**
      該節的五個步驟為：`npm ci` → 建立 `.env` → `db:schema` + `prisma migrate deploy`
      → **`npm run db:generate`** → `npm run build`。
      **第四步是 2026-08-11 補上的**：`src/generated/prisma` 未版控、`npm ci` 不會產生它、
      `migrate deploy` 也不像 `migrate dev` 會順帶產生 —— 少了它建置會失敗，
      而錯誤訊息不會指向這一步。

- [ ] 🚀 **D3. 啟動後檢查啟動記錄，MUST 看到這一行**

      ```
      [mail] mode=production from=NovelSite <noreply@你的網域>
      ```

      **看到下面任何一行就是設定沒吃到，MUST 停下來處理**：

      - `[mail] mode=console …` → `MAIL_MODE` 沒設或拼錯（拼錯會拒絕啟動，沒設則依 `NODE_ENV` 推導）
      - `[mail] CONTACT_EMAIL 未設定，採用過渡預設值 contact@example.com` → 佔位位址 `contact@example.com` 會被印在隱私權頁上，收不到任何信

---

## E. 郵件三項實收驗收

> **這一階段全部由人操作，且驗收對象一律是「信真的到得了」。**
> `arch.md` Phase 14 第 8 項：**驗收 MUST NOT 以「系統回報成功」充當送達。**
> 三項各自對應 `features.md` FEAT-5「完成定義」中目前刻意未勾的那幾列。

**本階段有一半可以在本機提前驗掉（B 階段做完就能做，不必等部署）**：
把本機 `.env` 暫時改成 `MAIL_MODE=production` + `RESEND_API_KEY` + `MAIL_FROM`
（`NEXT_PUBLIC_SITE_URL` 一併填上真網域，否則拒絕啟動），跑 `npm run dev` 後送出一次重設申請。

- **本機驗得到**：信有沒有寄出去、有沒有進收件匣、**SPF／DKIM／DMARC 過不過**（E4）——
  也就是整組外部條件裡**唯一會安靜失敗**的那一段。Resend 是 HTTPS API，不需要公開網址。
- **本機驗不到**：信裡的重設連結**點不開**。它是絕對網址、指向 `NEXT_PUBLIC_SITE_URL`，
  而那個網域此時還沒有伺服器。故 E3 的第 4 步、以及 E1／E2／E5（都要走公開網址）仍需部署後再做。

**驗完 MUST 把本機 `.env` 改回 `MAIL_MODE=console`** —— 留著 `production` 會讓之後每一次
本機測試都真的往外寄信，而那正是 SC-010 要防的事。

- [ ] 🚀 **E1. SC-007／`tasks.md` T043(b) —— 隱私權頁位址實測寄達**
      1. 開啟 `https://你的網域/novelsite/privacy`，找到第四節「你的權利」列出的 `mailto:` 位址；
      2. **從一個與該位址無關的外部信箱**寄一封信過去；
      3. 確認 5 分鐘內在 `CONTACT_EMAIL` 的收件端**實際收到**。
      **MUST NOT 以「頁面上有 `mailto:` 連結」充當送達** —— 這是法遵管道，
      驗收對象是「信真的到得了」，不是「頁面上印了一串字」。

- [ ] 🚀 **E2. SC-006 —— 聯絡表單送達與失敗顯示**
      1. 到 `https://你的網域/novelsite/contact` 送出一則訊息；
      2. 確認 **5 分鐘內** `CONTACT_EMAIL` 收到，且內文含稱呼／回覆 Email／訊息本文三段；
      3. 確認該信的**回覆位址是填表者的 Email**（直接按「回覆」應回給填表人，不是回給站台）。
      失敗分支已由 `tests/integration/contact-failure.test.ts` 自動把關，此處不需人工製造失敗。

- [ ] 🚀 **E3. SC-001 —— 密碼重設信實收**
      1. 用一個你收得到的信箱在站上註冊帳號；
      2. 到 `https://你的網域/novelsite/auth/forgot-password` 送出申請；
      3. 確認收到重設信，**並確認它進的是收件匣而不是垃圾匣**；
      4. 點連結設定新密碼 → 以新密碼登入成功、舊密碼失敗。
      **第 3 步是本階段的重點**：缺了 SPF／DKIM／DMARC 時，前面每一步都會「成功」，
      只有這一步會露餡。

- [ ] 🏠 **E4. 檢查郵件認證真的通過（不要只看「有收到」）**
      在 Gmail 開啟收到的信 → 右上角選單 →「顯示原始郵件」，確認
      **SPF、DKIM、DMARC 三項皆為 PASS**。
      或寄一封到 <https://www.mail-tester.com/> 取得評分與逐項診斷。
      **只看「有收到」不夠**：認證沒過的信在你自己的信箱可能正常，在別人的信箱進垃圾匣。

- [ ] 🚀 **E5. SC-008 —— 換信箱不需改程式碼、不需重新建置**
      把 `.env` 的 `CONTACT_EMAIL` 改成另一個位址 → **只重啟服務、不重新建置** →
      重新整理 `/novelsite/privacy` 與 `/novelsite/contact`，確認顯示新位址、舊位址零出現。
      （本項的本機版已於 2026-08-10 驗過，正式環境再驗一次即可。）

---

## F. FEAT-4 遺留的三項待外部條件

> 出處：`README.md`「待外部條件（FEAT-4）」、`arch.md` §9 Phase 13 第 6 項。
> 這三項與 FEAT-5 無關，但同樣卡在上線，順手一起收掉。

- [ ] 🚀 **F1. 正式環境 PostgreSQL 部署驗證**
      D 階段部署完成後，在正式庫上確認結構與索引正確、站台功能正常。
      **本機驗過不算**：2026-08-11 已用本機 PostgreSQL 17.6 跑過雙軌整合測試（76 檔 602 案一致），
      但 `arch.md` 明文「本機容器／執行個體不等於正式環境」，該項 MUST 待實際部署後才勾銷。
- [ ] 🚀 **F2. 部署平台的排程設定**
      依 `README.md`「排程作業接法」在正式機加 crontab 三筆：

      ```cron
      */10 * * * *  cd /srv/novelsite && npm run cron:publish
      30 0 * * *    cd /srv/novelsite && npm run cron:rollup
      45 0 * * *    cd /srv/novelsite && npm run cron:rankings
      ```

      **順序 MUST 是 rollup 先於 rankings**：計分讀的是 `NovelDailyStat`，
      反過來會讓排行永遠落後一天。並確認 `CRON_SECRET` 已設定 —— 未設定時那三個入口一律回 401，
      排程等於沒接上，**而且不會有任何錯誤畫面**。
- [ ] 🚀 **F3. 真實行動裝置實機測試**
      至少一台實體 iOS 與一台實體 Android。重點是**闔上手機時閱讀進度有沒有保住**
      （`useProgressReporter` 靠 `pagehide`，模擬器與桌機引擎的觸發時機和實機不同）。

---

## G. 完成後的文件回寫（憲章要求）

> 憲章「開發流程與品質閘門」：完成項目 MUST 於對應文件更新勾選狀態與**執行紀錄（含日期）**。
> **做完了卻沒回寫，下一個人會重做一次。**

- [ ] 🏠 **G1. `README.md`**：「待外部條件（FEAT-5）」三列、「待外部條件（FEAT-4）」三列，逐項勾銷並註記日期。
- [ ] 🏠 **G2. `features.md` FEAT-5**：「完成定義」中目前未勾的兩列
      （聯絡表單「確實送達營運信箱」、隱私權頁位址「經外部信箱實測寄達」）與「待外部條件」三列。
- [ ] 🏠 **G3. `arch.md` §9**：Phase 13 第 6 項、Phase 14 第 8 項，於執行紀錄補一段日期與實測結果。
- [ ] 🏠 **G4. `novelsite/plan.md`**：Phase 13 與 Phase 14 的待外部條件列。
- [ ] 🏠 **G5. `specs/005-email-recovery-contact/tasks.md`**：勾選 **T043**（其 (b) 即本檔 E1）。
- [ ] 🏠 **G6. 本檔**：把「目前狀態一覽」的 ⬜ 改為 ✅ 並記錄完成日期。

---

## 一句話總結每個階段最容易出錯的地方

| 階段 | 最容易出錯的地方 |
| --- | --- |
| 本機 | 以為「本機測試也要先申請 Resend」而卡住 —— **不需要**，本機走 `MAIL_MODE=console`，重設連結印在終端機上（SC-014） |
| A | 先挑註冊商才挑 TLD，買完發現要搬 ——**已由 2026-08-16 裁示（Cloudflare Registrar 直購）消除，但下單前 MUST 先在 Cloudflare 搜尋確認該 TLD 有支援；`.tw` 不在清單內** |
| B | **忘了 DMARC** —— Resend 不會提醒你，而缺它的症狀是「信寄出了但對方沒收到」 |
| C | 建了位址卻沒實測轉寄，到 E1 才發現 |
| D | 漏掉 `npm run db:generate`，建置失敗且錯誤訊息不指向它 |
| E | 以「畫面顯示已送出」當作驗收通過 —— 這正是整個 FEAT-5 反覆禁止的事 |
| F | crontab 順序寫反（rankings 排在 rollup 前面），排行永遠落後一天且無錯誤 |
| G | 做完了不回寫，下一輪審查再問一次「這個到底做了沒」 |
