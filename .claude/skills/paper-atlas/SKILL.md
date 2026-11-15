---
name: paper-atlas
description: 操作 Paper Atlas 文獻庫的總覽與入口。當使用者想查詢、瀏覽、修改或維護這個專案裡的 paper、知識圖譜、分類或網站，或你第一次在這個專案工作時使用。找新論文請用 find-papers；依研究題目給建議請用 research-advice。
---

# Paper Atlas

Paper Atlas 是一個以檔案為資料庫的論文文獻庫。每篇 paper 是 `data/papers/<id>.json` 一個檔案，格式固定；`build` 把它們轉成靜態網站（文獻列表、每篇的介紹頁、可拖拉的知識圖譜）。網站可以只在本機預覽，也可以部署（例如 Vercel 連動 GitHub，push 後自動重新部署）。每台電腦做到哪一步，由下面「每次改完資料之後」的同步設定決定，不要假設一定要 push。

你透過兩種方式之一操作它，功能相同：

- **CLI**：`node scripts/atlas.mjs <command>`（不需要安裝任何套件）
- **MCP 工具**：名稱以 `atlas_` 開頭（專案根目錄的 `.mcp.json` 已設定好 `paper-atlas` server）

## 使用者會要求的三類事情

| 使用者說 | 你要做的 |
|---|---|
| 「幫我找 X 主題的論文」「加幾篇關於 Y 的 paper」「把這篇加進去：<連結>」 | 使用 **find-papers** skill |
| 「我的研究題目是…請給建議」「庫裡有什麼對我的研究有幫助」 | 使用 **research-advice** skill |
| 查詢、修改、維護（「庫裡有哪些 RAG 的 paper」「把這篇改到另一個分類」「新增一個分類」） | 依照本檔下面的說明 |

## 查詢

| 目的 | CLI | MCP |
|---|---|---|
| 概況：領域、分類、篇數 | `overview` | `atlas_overview` |
| 列出 paper（可依分類、tag 篩選與排序） | `list [--category id] [--tag t] [--sort …]` | `atlas_list_papers` |
| 關鍵字搜尋 | `search <關鍵字>` | `atlas_search` |
| 一篇的完整紀錄 | `show <id>` | `atlas_get_paper` |
| 與一篇有關的庫內 paper（雙向關聯、引用、共用 tag） | `neighbors <id>` | `atlas_neighbors` |
| 給 LLM 讀的精簡總覽（每篇一行 + 關聯） | `context` | `atlas_library_context` |
| 被引用但尚未收錄的文獻 | `refs` | `atlas_missing_references` |
| 過去的搜尋紀錄 | `history` | `atlas_search_history` |
| 這台電腦改完資料後的收尾方式 | `sync-mode` | `atlas_sync_mode` |
| 分類、關聯類型、來源與篩選規則 | 讀 `config/domain.json` | `atlas_get_config` |

回答使用者關於庫內 paper 的問題時，以這些指令的輸出為準，不要憑印象。

## 修改既有的 paper

直接編輯 `data/papers/<id>.json`，然後執行 `node scripts/atlas.mjs validate`。常見的修改：

- 換分類：改 `category`（必須是 `config/domain.json` 裡的 id）。
- 補關聯：在 `relations` 加一筆 `{ "target", "type", "note" }`。
- 補齊參考文獻：更新 `references`，完整了就把 `references_complete` 改成 `true`。
- 修正介紹內容：改 `intro` 底下對應的段落。格式規則在 `prompts/paper-intro.md`。

不要改 `id`（會讓其他 paper 的 `relations` 與文字中的 `[[id]]` 失效）與 `added_at`（「依加入時間排序」依賴它）。

刪除 paper：刪掉檔案，再用 `grep -r "<id>" data/` 找出其他 paper 對它的 `relations` 與 `[[id]]` 並移除，最後 `validate`。刪除前先向使用者確認。

## 新增 paper

一律經過 `add`（CLI）或 `atlas_add_paper`（MCP），不要手動在 `data/papers/` 建檔：`add` 負責格式驗證、去重，以及寫入 `added_at`。完整流程在 find-papers skill。

## 調整系統

| 要做的事 | 改哪裡 |
|---|---|
| 改完資料後的收尾方式 | 這台電腦：`sync-mode <local\|commit\|push>`；整個 repo 的預設：`config/domain.json` → `site.sync` |
| 新增或修改分類、顏色 | `config/domain.json` → `categories` |
| 新增關聯類型 | `config/domain.json` → `relation_types` |
| 介紹多一個段落 | `config/domain.json` → `intro_sections`，並在 `prompts/paper-intro.md` 補上該段的寫法 |
| 換研究領域、搜尋來源、篩選規則 | `config/domain.json` → `domain`、`sources`、`selection` |
| 介紹的寫作規則 | `prompts/paper-intro.md` |
| 研究建議的規則 | `prompts/research-advice.md` |
| 網站外觀與頁面 | `site/`（`styles.css`、`js/views/*.js`） |
| 新增 CLI 指令或 MCP 工具 | 功能寫在 `scripts/lib/library.mjs`，再到 `scripts/atlas.mjs` 與 `mcp/server.mjs` 各加一個入口 |

改 `config/domain.json` 的分類或關聯類型屬於使用者的決定：先提出建議並取得同意再改。

## 每次改完資料之後

1. `node scripts/atlas.mjs build`（`atlas_build`）。它內含 validate；失敗就依錯誤訊息修正，修到通過為止。
2. `node scripts/atlas.mjs sync-mode`（`atlas_sync_mode`），照它列出的步驟收尾。同步設定有三種：

| 設定 | 收尾方式 | 適合 |
|---|---|---|
| `local` | 不動 git；告訴使用者用 `serve` 預覽 | 只在自己電腦上使用、沒有 push 權限、從 ZIP 下載的副本 |
| `commit` | git commit，不 push | 想保留版本紀錄，但不部署 |
| `push` | git commit 後 git push | 負責更新線上網站的電腦 |

設定的來源依序是：`config/local.json`（這台電腦專用，不進 git）、`config/domain.json` 的 `site.sync`（整個 repo 共用的預設）；兩者都沒有時是 `local`。

- 使用者在對話中明確要求（例如「先不要 push」「幫我 push」）時，以使用者的話為準。
- 更改設定本身（`sync-mode <模式>`）只在使用者要求時做。
- push 被拒絕時不要重試、不要更改 remote：保留 commit，把錯誤原文告訴使用者，並提到可以改成 `local`。
- `site/data/` 是 build 的產物，已列在 `.gitignore`，不要 commit。

想先看結果可以執行 `node scripts/atlas.mjs serve`，在 http://localhost:4173 預覽。

## 回報

做完之後用幾句話告訴使用者：改了什麼（附 paper id）、build 是否通過、依同步設定做到哪一步（只更新本機、已 commit，或已 push；push 被拒絕時附上錯誤原文）。遇到 `add` 或 `validate` 的錯誤而無法自行修正時，把錯誤訊息原文交給使用者，不要繞過檢查。
