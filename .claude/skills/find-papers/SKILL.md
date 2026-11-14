---
name: find-papers
description: 依使用者指定的主題或領域，照固定規則到指定來源搜尋論文、排除已收錄與已評估過的、用固定格式寫介紹並加入 Paper Atlas。當使用者說「找 X 的論文」「加幾篇關於 Y 的 paper」「更新文獻庫」或給一個論文連結要求收錄時使用。
---

# 找論文並加入文獻庫

使用者只需要說想找什麼主題。其餘的事（去哪裡找、怎麼挑、怎麼避免重複、怎麼寫介紹、怎麼更新網站）都照這份流程做，讓每次搜尋的結果品質一致、可追溯。

最重要的一條規則：**文獻庫裡已經有的 paper、以及先前評估後決定不收錄的 paper，不可以再出現**。這由 `check` 與 `add` 兩道檢查強制執行，你的工作是每個候選都先 `check`。

以下指令都是 `node scripts/atlas.mjs <command>`；括號內是對應的 MCP 工具。

## 0. 釐清需求

從使用者的話判斷，不夠明確才問，而且只問一次：

- **主題**：必要。太寬（「LLM」）時請使用者縮小，或由你提出 2 到 3 個子主題讓他選。
- **篇數**：沒說就用 `config/domain.json` 的 `limits.default_papers_per_run`（目前 5 篇），上限是 `limits.max_papers_per_run`。
- **條件**：年份範圍、特定會議、要奠基之作還是最新進展。沒說就照下面的預設規則。

使用者直接給了論文連結或標題時，跳到第 3 步，對那一篇做 `check` 後進第 5 步。

## 1. 了解文獻庫現況

依序執行：

1. `overview`（`atlas_overview`）：領域範圍與分類。主題若落在 `domain.out_of_scope`，先告訴使用者並確認要不要繼續。
2. `search <主題關鍵字>`（`atlas_search`）：庫裡已經有哪些相關的 paper。這決定你要找的是「補缺口」還是「起頭」。
3. `history`（`atlas_search_history`）：以前搜過什麼、用過哪些查詢字串。這次要用**不同的查詢字串**或更新的時間範圍，否則只會找到同一批。
4. `refs --min-cited-by 2`（`atlas_missing_references`）：被多篇庫內 paper 引用但尚未收錄的文獻。其中與主題相關的，是品質最有保證的候選。

## 2. 搜尋

**來源與優先順序**定義在 `config/domain.json` 的 `sources`（`atlas_get_config`），每個來源有用途說明與搜尋網址樣板。依 `priority` 由小到大使用，目前是：

1. Semantic Scholar：主要入口，可依引用數排序，並提供 DOI / arXiv ID。
2. arXiv：最新的 preprint。
3. OpenReview：ICLR、NeurIPS、ICML，可參考審稿意見。
4. ACL Anthology：NLP 會議的正式版本。
5. Hugging Face Papers：程式碼連結與近期受關注的論文。

**查詢字串**：準備 3 到 5 個，涵蓋主題的英文正式名稱、常見縮寫或同義說法、一個較寬與一個較窄的說法。例如主題「RAG 的評測」：`retrieval-augmented generation evaluation`、`RAG benchmark`、`faithfulness evaluation retrieval augmented`、`attribution evaluation LLM`。

**怎麼查**：優先用來源的 API（`sources[].api`），以你的網頁擷取工具取得；API 無法存取時，用搜尋工具加上來源名稱查詢。至少查前兩個來源；頭兩個來源的結果不足時再往下。

**滾雪球**：對第 1 步找到的相關庫內 paper，查看「引用它的新論文」（Semantic Scholar 的 citations）與它的參考文獻。這通常比關鍵字搜尋更準。

整理出最多 20 篇的候選清單，每篇記下：標題、arXiv ID 或 DOI、年份、發表場合、引用數、來源。

## 3. 去重：每一個候選都要做

對清單上的每一篇執行：

```bash
node scripts/atlas.mjs check --title "<完整標題>" --arxiv <id> --doi <doi>
```

（`atlas_check_duplicate`）有 arXiv ID 或 DOI 就一定要帶上，只靠標題比對會漏掉改過標題的版本。

| 結果 | 意思 | 處理 |
|---|---|---|
| `new`（exit 0） | 沒處理過 | 留在候選清單 |
| `in_library`（exit 1） | 已收錄 | 移出清單。不要重寫、不要覆蓋。 |
| `rejected_before`（exit 2） | 以前評估過、決定不收 | 移出清單，除非使用者這次明確點名要這一篇 |

同一篇論文的 preprint 與正式發表版本算同一篇。若庫內是 preprint 而現在已正式發表，更新既有檔案的 `venue`、`year`、`ids.doi` 即可，不要新增。

去重之後候選不足時，回到第 2 步換查詢字串再找一輪；兩輪之後仍不足，就如實告訴使用者這個主題目前只找到這些。

## 4. 篩選

規則定義在 `config/domain.json` 的 `selection`，目前是：

- **相關性**：讀摘要。論文的主要貢獻要落在使用者的主題內，只有關鍵字重疊的不算。
- **品質**：`trusted_venues` 清單上的會議或期刊可直接考慮。preprint 需符合 `preprint_rule`（有公開程式碼或可重現的實驗細節、作者群在該主題已有同儕審查成果、或已有足夠引用）。
- **組合**：依 `recency_mix`，收錄 3 篇以上時，要同時包含近 12 個月的新論文與該主題的奠基之作（若尚未收錄）。不要整批都是同一個研究團隊或同一條技術路線。
- **排除**：符合 `reject_if` 任何一項的不收。

依「相關性 → 品質 → 對文獻庫的補充程度」排序，取前 N 篇（N 為使用者要的篇數）。

**記錄不收錄的**：你實際看過摘要或全文、判斷**不適合收錄**的候選（不相關、品質不足、找不到全文），執行：

```bash
node scripts/atlas.mjs reject --title "<標題>" --arxiv <id> --reason "<具體原因>" --topic "<這次的主題>"
```

（`atlas_reject_paper`）這樣下次搜尋不會再花時間評估同一篇。**只是因為名額滿了而沒入選**的合格論文不要 `reject`，它們下次還可以被選上；在回報時列為「下次可以考慮」。

## 5. 撰寫介紹並加入

對每一篇入選的論文：

1. **取得全文**並讀完（arXiv 的 HTML 或 PDF、ACL Anthology 的 PDF、OpenReview）。只讀摘要不可以寫介紹。拿不到全文就 `reject`，原因寫「找不到全文」，換下一個候選遞補。
2. **取得參考文獻清單**：用 `sources` 中 Semantic Scholar 的 `references_api`；失敗時從 PDF 的 References 一節整理。
3. **依 `prompts/paper-intro.md` 的規則**（`atlas_get_prompt`，name 為 `paper-intro`）寫出該篇的 JSON。這份 prompt 定義了每個欄位與每個段落的寫法，寫之前完整讀一遍。寫之前先執行 `context`，才能正確填 `relations`、沿用既有 tag。
4. **加入**：把 JSON 存成暫存檔（例如 `/tmp/<id>.json`），執行

   ```bash
   node scripts/atlas.mjs add /tmp/<id>.json --by "<你的名稱，例如 claude-code>"
   ```

   （`atlas_add_paper`）
5. `add` 回報錯誤時，依訊息修正 JSON 後重試。回報「重複」時表示第 3 步漏了，放棄這一篇，不要改 id 或標題來規避。
6. `add` 成功後的輸出會列出 `cites_in_library` 與 `cited_by_in_library`。若新 paper 與這些庫內 paper 有實質關係而你還沒寫進 `relations`，現在補上（編輯 `data/papers/<id>.json`）。若是既有 paper 應該關聯到新 paper，就編輯那篇既有 paper 的 `relations`。

一篇一篇做完再做下一篇：後加入的 paper 才能關聯到先加入的。建議依發表時間由舊到新加入。

## 6. 更新網站並留下紀錄

```bash
node scripts/atlas.mjs build
node scripts/atlas.mjs log-search --topic "<主題>" --queries "<查詢1>;<查詢2>;…" \
  --sources "<用到的來源 id，逗號分隔>" --added "<id1>,<id2>,…" --rejected <記錄為不收錄的篇數> \
  --note "<下次可以考慮但這次沒收的、或值得一提的事>"
git add -A
git commit -m "papers: add <N> on <主題>"
git push
```

（`atlas_build`、`atlas_log_search`；git 用 shell 執行）

`build` 失敗就修到通過為止，不要 push 壞掉的狀態。push 之後 Vercel 會自動重新部署網站。沒有 push 權限時，完成 commit 並告訴使用者需要他來 push。

## 7. 回報

用下面的結構告訴使用者結果，不要貼出完整的介紹內容（他可以到網站上看）：

- **新增**：每篇一行，包含標題、分類、一句話介紹。
- **略過**：幾篇因為已收錄、幾篇因為先前評估過。
- **不收錄**：每篇一行，附原因。
- **下次可以考慮**：合格但這次沒收的候選。
- **觀察**：這個主題在文獻庫裡還缺什麼、建議下一次搜尋的方向。

## 不可以做的事

- 不可以編造論文、作者、數字或參考文獻。查不到的資訊留空或如實說明。
- 不可以跳過 `check`，也不可以手動在 `data/papers/` 建檔來繞過 `add`。
- 不可以為了湊滿篇數而收錄不符合篩選規則的論文。找不到足夠的好論文時，少收並說明。
- 不可以修改 `config/domain.json` 的分類與篩選規則來讓某篇論文過關。認為規則該調整時，向使用者提出。
- 不可以下載或轉載論文全文到 repo 裡。文獻庫只存介紹與連結。
