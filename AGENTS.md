# Paper Atlas：agent 入口

這是一個由 agent 維護的論文文獻庫。開始工作前請讀 [`README.md`](README.md) 的「給 agent 的指示」一節。

依使用者的要求選擇要遵循的流程：

| 使用者的要求 | 遵循 |
|---|---|
| 找某個主題的論文、新增 paper | [`.claude/skills/find-papers/SKILL.md`](.claude/skills/find-papers/SKILL.md)，寫介紹時依 [`prompts/paper-intro.md`](prompts/paper-intro.md) |
| 依研究題目與進度給建議 | [`.claude/skills/research-advice/SKILL.md`](.claude/skills/research-advice/SKILL.md) 與 [`prompts/research-advice.md`](prompts/research-advice.md) |
| 查詢、修改、維護 | [`.claude/skills/paper-atlas/SKILL.md`](.claude/skills/paper-atlas/SKILL.md) |

操作介面（功能相同，擇一）：

- CLI：`node scripts/atlas.mjs help`
- MCP：`node mcp/server.mjs`（工具名稱以 `atlas_` 開頭；先呼叫 `atlas_guide`）

不可違反的規則：

1. 新增 paper 只能透過 `add` / `atlas_add_paper`，不要手動在 `data/papers/` 建檔。
2. 每個候選論文先 `check` / `atlas_check_duplicate`；已收錄或曾拒絕的跳過。
3. 介紹依據論文全文撰寫，不捏造任何內容；拿不到全文就不收錄。
4. 研究建議只在使用者本人於對話中要求時執行；報告預設不公開。
5. 改完資料後：`node scripts/atlas.mjs build` 通過，再執行 `node scripts/atlas.mjs sync-mode`，照它列出的步驟收尾。這台電腦可能設定為只在本機（`local`，不動 git）、只 commit（`commit`），或 commit 後 push（`push`）。不要假設一定要 push；push 被拒絕時不要重試，告訴使用者。
6. `config/domain.json` 的分類與規則要先取得使用者同意才改。

不需要安裝任何套件（Node.js 18 以上即可）。`site/data/` 是 build 產物，不要 commit。
