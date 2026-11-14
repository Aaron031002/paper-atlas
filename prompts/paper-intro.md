# Prompt：撰寫一篇 paper 的介紹

> 這份 prompt 給負責寫 paper 介紹的 LLM 讀。照著它產出的 JSON 可以直接交給
> `node scripts/atlas.mjs add <file.json>`（或 MCP 工具 `atlas_add_paper`）寫入文獻庫。

## 你的任務

你要為 Paper Atlas 文獻庫寫一篇論文的介紹。讀者是正在做研究的研究生：他們會先在列表上看到分類與一句話介紹，決定要不要點進來；點進來後，希望在五分鐘內知道這篇 paper 解決什麼問題、怎麼做、做到什麼程度、有哪些限制，以及跟自己的研究有什麼關係。

所有介紹都用同一個固定格式，因為網站、知識圖譜與「研究建議」功能都直接讀取這些欄位。格式不對，`add` 會拒絕寫入並告訴你哪裡要改。

## 開始前必須具備的資料

1. **論文全文**（PDF 或 HTML）。只有摘要不夠：方法、結果與限制都要以全文為準。拿不到全文就不要寫，把這篇用 `reject` 記錄為「找不到全文」。
2. **書目資料**：標題、作者（依論文上的順序）、發表場合、首次公開日期、arXiv ID 或 DOI。
3. **參考文獻清單**。優先用 Semantic Scholar API 取得完整清單（網址樣板在 `config/domain.json` 的 `sources[0].references_api`）；拿不到時改從論文 PDF 的 References 一節整理。
4. **文獻庫現況**：執行 `node scripts/atlas.mjs context`，知道目前有哪些 paper、它們的 id 是什麼，才能填 `relations` 與在文字裡連結。
5. **設定檔** `config/domain.json`：可用的分類（`categories`）、關聯類型（`relation_types`）與介紹的段落（`intro_sections`）。

## 輸出

只輸出一個 JSON 物件，存成檔案。不要包在 Markdown code fence 裡，不要加註解。

```json
{
  "id": "lewis2020-rag",
  "title": "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
  "authors": ["Patrick Lewis", "Ethan Perez"],
  "venue": "NeurIPS 2020",
  "year": 2020,
  "published": "2020-05-22",
  "ids": { "arxiv": "2005.11401", "doi": null },
  "links": { "paper": "https://arxiv.org/abs/2005.11401", "pdf": "https://arxiv.org/pdf/2005.11401", "code": null, "project": null },
  "category": "retrieval",
  "tags": ["dense-retrieval", "open-domain-qa", "retrieval-augmented-generation"],
  "one_liner": "把稠密檢索器接上 seq2seq 生成模型端到端微調，讓生成內容有外部知識可依據。",
  "intro": {
    "tldr": ["…", "…", "…"],
    "problem": "…",
    "method": "…",
    "contributions": ["…", "…"],
    "results": "…",
    "limitations": "…",
    "takeaways": "…"
  },
  "relations": [
    { "target": "karpukhin2020-dpr", "type": "builds-on", "note": "RAG 的 retriever 直接使用 DPR 的雙塔 encoder 與 Wikipedia 索引。" }
  ],
  "references": [
    { "title": "Dense Passage Retrieval for Open-Domain Question Answering", "authors": "Karpukhin et al.", "year": 2020, "arxiv": "2004.04906" }
  ],
  "references_complete": true,
  "source": { "found_via": "semantic-scholar", "query": "retrieval augmented generation", "retrieved_at": "2026-11-15" }
}
```

完整的實例請看 `data/papers/` 底下任何一個檔案。`added_at` 與 `added_by` 不用填，`add` 會自動寫入。

## 欄位規則

### 書目欄位

| 欄位 | 規則 |
|---|---|
| `id` | `第一作者姓氏小寫 + 首次公開年份 + "-" + 一到三個關鍵字`，只用小寫英數與連字號。例：`vaswani2017-attention`、`yao2022-react`。年份取 `published` 的年份。姓氏有變音符號時轉成最接近的 ASCII 字母。 |
| `title` | 論文原始標題，大小寫照原文，不翻譯。 |
| `authors` | 全部作者的完整姓名，依論文上的順序，一人一個字串。不要用 "et al." 省略。 |
| `venue` | 正式發表場合加年份，例如 `"ICLR 2023"`、`"EMNLP 2020"`。尚未正式發表填 `"arXiv preprint"`。期刊填期刊名與年份。 |
| `year` | `venue` 的年份（整數）。preprint 填首次公開的年份。 |
| `published` | **首次公開**的日期：有 arXiv 版本就用 v1 的提交日期，格式 `YYYY-MM-DD`；只知道月份填 `YYYY-MM`；只知道年份填 `YYYY`。這個欄位決定「依發表時間排序」的結果，不要用最後修訂日期或會議舉辦日期。 |
| `ids.arxiv` | arXiv ID，不含版本號與前綴，例如 `"2005.11401"`。沒有就填 `null`。 |
| `ids.doi` | DOI，不含 `https://doi.org/`。沒有就填 `null`。arXiv 自動發的 `10.48550/arXiv.*` 不用填。 |
| `links.paper` | 論文頁面網址（必填）。優先用 arXiv abs 頁，其次 ACL Anthology、OpenReview、出版社頁面。 |
| `links.pdf` / `code` / `project` | 有就填，沒有填 `null`。`code` 只填作者自己釋出的官方程式碼。 |
| `source.found_via` | 你是從哪個來源找到這篇的，填 `config/domain.json` 中 `sources[].id` 的值；從庫內 paper 的參考文獻找到的填 `"references"`；使用者直接指定的填 `"user"`。 |
| `source.query` | 當時用的搜尋關鍵字。 |
| `source.retrieved_at` | 今天的日期 `YYYY-MM-DD`。 |

`ids` 至少要有 `arxiv` 或 `doi` 其中一個才能可靠地去重。兩者都沒有的論文可以收錄，但 `add` 會警告，因為之後只能靠標題比對。

### `category`：分類

從 `config/domain.json` 的 `categories` 選**一個** `id`。判斷依據是這篇 paper 的**主要貢獻**屬於哪一類，而不是它用到了什麼。例如一篇用 RAG 來做 agent 記憶的論文，主要貢獻在 agent，就選 `agents`。

真的沒有合適的分類時選 `other`，並在回報給使用者時說明。不要自己發明分類 id；新增分類要改 `config/domain.json`，那是使用者的決定。

### `tags`：概念標籤

2 到 8 個，全部小寫、以連字號取代空白（`dense-retrieval`，不是 `Dense Retrieval`）。

tag 會成為知識圖譜上的「概念」節點：兩篇以上的 paper 共用同一個 tag，就會被連在一起。所以：

- **先重複使用既有的 tag**。`context` 的輸出列出了每篇 paper 的 tag，意思相同就用同一個字串，不要另創 `rag` 與 `retrieval-augmented-generation` 兩個。
- tag 描述的是方法、任務、資料型態或研究問題（`in-context-learning`、`open-domain-qa`、`low-rank`），不是分類名稱的重複，也不是 `deep-learning`、`nlp` 這種每篇都適用的詞。

### `one_liner`：一句話介紹

使用者在列表上第一眼看到的就是這句，它要讓人不點進去也知道這篇在做什麼。

- 一句話，不換行，最多 60 個字（中英文字元都算一個字）。
- 說出「做了什麼」加上「因此得到什麼」。有具體的機制或結果就寫具體的。
- 不要以「本文」「這篇論文」「作者提出」開頭，直接講內容。
- 不要寫成標題的翻譯，也不要用「創新的」「強大的」這類評價詞。

好的例子：「凍結預訓練權重，只訓練注入各層的低秩矩陣，可訓練參數少萬倍且推論不變慢。」
不好的例子：「本文提出一個創新的高效微調方法 LoRA。」（沒說怎麼做、沒說結果）

### `intro`：介紹本文

段落的 key、順序與是否必填定義在 `config/domain.json` 的 `intro_sections`，以那裡為準。目前的段落如下。型態為 bullets 的欄位是字串陣列；型態為 markdown 的欄位是一個字串，可以使用下面「文字格式」列出的語法。

**`tldr`（重點摘要，bullets，2 到 5 點）**
只讀這幾點就能掌握全篇。通常是：提出了什麼、關鍵機制是什麼、最重要的一個結果。每點一句完整的話。

**`problem`（研究問題與動機，markdown）**
這篇 paper 之前，大家怎麼做？那樣做哪裡不夠？作者想回答的具體問題是什麼？寫 3 到 6 句。讀者讀完應該能說出「為什麼需要這篇 paper」。

**`method`（方法，markdown）**
這是最重要的一段。寫到一個同領域的研究生能大致重現核心想法的程度：模型或系統由哪些部分組成、資料怎麼流動、訓練目標是什麼、關鍵的設計選擇是什麼以及為什麼。可以用條列。公式用行內 code 表示（例如 `` `W = W₀ + BA` ``），並用文字說明每個符號。不要逐節複述論文，挑真正構成方法的部分。

**`contributions`（主要貢獻，bullets，1 到 6 點）**
作者宣稱的貢獻，通常在 Introduction 結尾。用自己的話寫，每點一句。只列實質的貢獻，「我們做了大量實驗」不算。

**`results`（實驗與結果，markdown）**
在哪些資料集或任務上評測、跟誰比、贏多少。**數字必須是論文裡寫的數字**，並說明是什麼指標、在什麼設定下。只挑最能支持論文主張的兩到四個結果，再加上值得注意的消融或分析發現。若有某個設定下方法表現不好，也要寫。

**`limitations`（限制，markdown）**
先寫作者自己承認的限制（通常在 Limitations、Discussion 或 Conclusion）。如果你從實驗設計看出作者沒提到的限制，可以寫，但必須明確標示，以「以下為讀者觀察、非作者自述：」開頭。這個區分很重要：「研究建議」功能會把限制當成後續研究的切入點，使用者需要知道哪些是有論文背書的。

**`takeaways`（對後續研究的啟發，markdown）**
這篇 paper 在研究脈絡中的位置：它開啟了什麼方向、後來的工作怎麼回應它、做相關研究的人可以從它借用什麼（方法、實驗設計、baseline、資料集）。提到庫內其他 paper 時用 `[[paper-id]]` 連結。這段可以有你的判斷，但要說得出理由。

### 文字格式

`intro` 裡的 markdown 欄位與 bullets 的每一點都支援：

- `**粗體**`：只用在讀者掃讀時最該看到的詞，一段最多兩三處。
- `` `行內 code` ``：公式、特殊 token、函式名稱。
- `- ` 開頭的條列、`1. ` 開頭的編號清單。段落之間用 `\n\n` 分隔。
- `[文字](https://…)`：外部連結。
- `[[paper-id]]`：連到文獻庫裡的另一篇 paper，網站會自動顯示成該 paper 的標題。只能用於已經在庫內的 id。

不支援 LaTeX、圖片與 HTML。

### `relations`：與庫內其他 paper 的關聯

這是知識圖譜上最有價值的邊。對照 `context` 輸出的現有 paper，找出與這篇有**實質關係**的，每一條寫成：

```json
{ "target": "<庫內 paper 的 id>", "type": "<關聯類型>", "note": "<一句話說明>" }
```

- `target` 必須是已經在文獻庫裡的 id。還沒收錄的 paper 不能當 target（它會出現在 `references` 裡，之後收錄時再由那篇來建立關聯）。
- `type` 從 `config/domain.json` 的 `relation_types` 選。方向是「這篇 → target」：例如 `builds-on` 表示這篇建立在 target 之上。
- `note` 用一句話說明具體關係，要能回答「是哪個部分、怎麼用」。「兩篇都跟檢索有關」這種說明等於沒寫。
- 單純有引用但沒有實質關係的，**不要**寫進 `relations`。引用關係會由 `references` 自動產生圖譜上的「引用」邊。
- 沒有實質關聯就給空陣列 `[]`，不要硬湊。

### `references`：這篇 paper 引用的文獻

介紹頁的最後會列出這份清單；已收錄在庫內的會自動標示並連結；被多篇庫內 paper 引用但尚未收錄的，會成為下次搜尋與研究建議的推薦來源。所以要盡量完整且可比對。

每一筆：

```json
{ "title": "完整標題", "authors": "Karpukhin et al.", "year": 2020, "arxiv": "2004.04906", "doi": null, "url": null }
```

- `title` 必填，用完整的原始標題（比對是否已收錄時會用到）。
- `authors` 用簡短形式即可：三人以內全列姓氏，否則「第一作者姓氏 et al.」。
- `arxiv`、`doi` 有就填，這是最可靠的比對依據。都沒有時可填 `url`。
- 你**不需要**自己判斷哪些已收錄，build 時會自動比對。
- 取得完整清單時 `references_complete` 填 `true`。只整理出一部分（例如 API 查不到、PDF 的參考文獻無法完整擷取）時填 `false`，並至少列出論文正文中反覆引用、方法或實驗直接依賴的那些。
- 不要列入你不確定是否真的被這篇 paper 引用的文獻。

## 語言

- 介紹以**繁體中文**撰寫（語言設定在 `config/domain.json` 的 `site.language`）。
- 專有名詞、模型名稱、方法名稱、資料集名稱保留英文原文（Transformer、self-attention、fine-tuning、GLUE）。第一次出現且中文讀者可能不熟的術語，可以在後面用括號加簡短中文說明。
- 不要逐句翻譯摘要。用你讀完全文後的理解重新組織。
- 語氣平實、具體。不用「革命性」「劃時代」這類形容；一篇 paper 重不重要，讓結果與後續影響自己說明。

## 正確性

這個文獻庫的價值在於使用者可以信任它。寫錯的介紹比沒有介紹更糟，因為使用者會根據它決定要不要讀原文、要不要拿來當 baseline。

- 每一個數字、每一個「優於某方法」的說法，都要能在論文裡找到出處。找不到就不要寫。
- 不確定的細節（某個超參數、某個資料集的大小）寧可省略，不要猜。
- 論文沒做的實驗，不要寫成做了。論文只在特定設定下成立的結論，要連同設定一起寫。
- 書目資料（作者、日期、venue）要對照來源頁面確認，不要憑印象。
- 區分三種陳述：論文的實驗結果、作者的主張或解釋、你自己的觀察。第三種只能出現在 `limitations`（需標示）與 `takeaways`。

## 交出去之前的檢查

1. `one_liner` 不超過 60 個字、沒有「本文」開頭、不換行。
2. `results` 裡的每個數字都對照過論文。
3. `limitations` 中作者自述與讀者觀察有分開標示。
4. `category` 與每個 `relations[].type` 都是設定檔裡存在的 id；每個 `relations[].target` 都是庫內現有的 id。
5. `tags` 已盡量沿用既有的 tag。
6. `references` 每筆都有完整標題，`references_complete` 如實填寫。
7. 文字中的 `[[…]]` 都是庫內現有的 id。
8. 整份輸出是合法的 JSON（字串裡的換行寫成 `\n`、雙引號寫成 `\"`）。

寫入時執行 `node scripts/atlas.mjs add <file.json>`。它回報錯誤時，依訊息修正後重試；不要繞過它直接把檔案放進 `data/papers/`，那會跳過去重與格式檢查。
