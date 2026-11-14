#!/usr/bin/env node
// Paper Atlas MCP server (stdio transport, no dependencies).
//
// Exposes the same operations as the CLI as MCP tools, so any MCP-capable agent
// can operate the library. All logic lives in scripts/lib/; this file only maps
// tool calls onto those functions.
//
// Run:      node mcp/server.mjs
// Register: see .mcp.json at the repository root, or the README.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as lib from '../scripts/lib/library.mjs';
import { build } from '../scripts/lib/build.mjs';
import { validateLibrary } from '../scripts/lib/validate.mjs';
import { ROOT, loadConfig, loadPapers, readPrompt } from '../scripts/lib/store.mjs';

const SERVER = { name: 'paper-atlas', version: '1.0.0' };
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Paper Atlas 是一個論文文獻庫。先呼叫 atlas_guide 讀操作說明。
找新論文：依 atlas_get_skill("find-papers") 的流程；每個候選都先 atlas_check_duplicate，再用 atlas_add_paper 加入。
給研究建議：依 atlas_get_prompt("research-advice") 的規則，只在使用者本人要求時執行。
資料改動後呼叫 atlas_build，再用 shell 執行 git commit 與 git push。`;

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

const readSkill = (name) => {
  const file = path.join(ROOT, '.claude', 'skills', name, 'SKILL.md');
  if (!fs.existsSync(file)) throw new Error(`沒有名為「${name}」的 skill。可用：paper-atlas、find-papers、research-advice`);
  return fs.readFileSync(file, 'utf8');
};

/** name -> { description, inputSchema, run(args) }. To add a tool, add an entry here. */
const TOOLS = {
  atlas_guide: {
    description: '操作說明：這個系統是什麼、有哪些操作、每次修改後要做什麼。第一次使用時先讀這個。',
    inputSchema: obj({}),
    run: () => readSkill('paper-atlas'),
  },
  atlas_get_skill: {
    description: '取得某個工作流程的完整步驟。find-papers：依主題找論文並加入文獻庫；research-advice：依研究題目給建議；paper-atlas：系統總覽。',
    inputSchema: obj({ name: str('skill 名稱', { enum: ['paper-atlas', 'find-papers', 'research-advice'] }) }, ['name']),
    run: ({ name }) => readSkill(name),
  },
  atlas_get_prompt: {
    description: '取得 prompt 全文。paper-intro：paper 介紹的固定格式與每個欄位的寫法，寫介紹前必讀；research-advice：研究建議的規則與報告骨架。',
    inputSchema: obj({ name: str('prompt 名稱', { enum: ['paper-intro', 'research-advice'] }) }, ['name']),
    run: ({ name }) => readPrompt(name),
  },
  atlas_get_config: {
    description: '設定檔全文：研究領域與範圍、分類、關聯類型、介紹的段落、搜尋來源與優先順序、篩選規則、篇數上限。',
    inputSchema: obj({}),
    run: () => loadConfig(),
  },
  atlas_overview: {
    description: '文獻庫概況：領域、各分類篇數、最近加入的 paper、搜尋與拒絕紀錄的數量。',
    inputSchema: obj({}),
    run: () => lib.overview(),
  },
  atlas_list_papers: {
    description: '列出 paper（每篇含 id、標題、分類、一句話介紹、發表與加入時間）。可依分類或 tag 篩選並排序。',
    inputSchema: obj({
      category: str('分類 id，例如 retrieval'),
      tag: str('tag，例如 dense-retrieval'),
      sort: str('排序方式，預設 added-desc', { enum: ['added-desc', 'added-asc', 'published-desc', 'published-asc', 'title'] }),
    }),
    run: (args) => lib.listPapers(args),
  },
  atlas_search: {
    description: '在文獻庫內以關鍵字搜尋（標題、tag、一句話介紹、作者、介紹內文），依相關度排序。這只搜尋已收錄的 paper，不會上網找新論文。',
    inputSchema: obj({ query: str('關鍵字，可多個，以空白分隔'), limit: int('最多回傳幾篇，預設 10') }, ['query']),
    run: ({ query, limit }) => lib.searchPapers(query, { limit: limit || 10 }),
  },
  atlas_get_paper: {
    description: '一篇 paper 的完整紀錄：書目資料、介紹的每個段落、關聯、參考文獻。',
    inputSchema: obj({ id: str('paper id，例如 lewis2020-rag') }, ['id']),
    run: ({ id }) => lib.getPaper(id),
  },
  atlas_neighbors: {
    description: '與某篇 paper 有關的庫內 paper：它指向別人的關聯、別人指向它的關聯、它引用的、引用它的、與它共用 tag 的。做研究建議時用來沿著關聯多看一步。',
    inputSchema: obj({ id: str('paper id') }, ['id']),
    run: ({ id }) => lib.neighbors(id),
  },
  atlas_library_context: {
    description: '給 LLM 讀的精簡總覽：每篇 paper 一行（id、年份、分類、標題、一句話介紹、tags）加上所有關聯。寫新 paper 的 relations 或做研究建議前先讀這個。',
    inputSchema: obj({}),
    run: () => lib.libraryContext(),
  },
  atlas_check_duplicate: {
    description: '檢查一篇論文是否已收錄（in_library）、曾被評估為不收錄（rejected_before）、或是新的（new）。找論文時每個候選都必須先呼叫。有 arXiv ID 或 DOI 就一定要帶上。',
    inputSchema: obj({ title: str('論文完整標題'), arxiv: str('arXiv ID，例如 2005.11401'), doi: str('DOI') }),
    run: (args) => lib.checkDuplicate(args),
  },
  atlas_add_paper: {
    description: '把一篇 paper 加入文獻庫。會驗證格式（依 atlas_get_prompt("paper-intro") 的規則）、拒絕重複、寫入加入時間，成功後自動重建網站資料。失敗時回傳 errors，修正後重試。',
    inputSchema: obj({
      paper: { type: 'object', description: '完整的 paper JSON 物件，格式見 atlas_get_prompt("paper-intro")' },
      by: str('由誰加入，例如 claude-code；預設 agent'),
      override_rejected: { type: 'boolean', description: '這篇曾被記錄為不收錄，但使用者這次明確要求收錄時設為 true' },
    }, ['paper']),
    run: ({ paper, by, override_rejected }) => {
      const result = lib.addPaper(paper, { by: by || 'agent', overrideRejected: Boolean(override_rejected) });
      if (result.ok) {
        const built = build();
        result.build = built.ok ? `網站資料已更新（${built.papers} 篇）` : { errors: built.errors };
        result.next = '用 shell 執行 git add -A && git commit && git push，網站才會更新。';
      }
      return result;
    },
  },
  atlas_reject_paper: {
    description: '記錄一篇評估後決定不收錄的論文與原因，之後的搜尋會略過它。只用於實際看過且判斷不適合的論文；因名額已滿而未入選的合格論文不要記錄。',
    inputSchema: obj({
      title: str('論文完整標題'), reason: str('不收錄的具體原因'), arxiv: str('arXiv ID'), doi: str('DOI'), topic: str('當時搜尋的主題'),
    }, ['title', 'reason']),
    run: (args) => lib.rejectPaper(args),
  },
  atlas_log_search: {
    description: '記錄一次搜尋：主題、用過的查詢字串、來源、加入了哪些 paper。每次找論文結束時呼叫，下次搜尋會參考它以避免重複同樣的查詢。',
    inputSchema: obj({
      topic: str('這次搜尋的主題'),
      queries: { type: 'array', items: { type: 'string' }, description: '用過的查詢字串' },
      sources: { type: 'array', items: { type: 'string' }, description: '用到的來源 id' },
      added: { type: 'array', items: { type: 'string' }, description: '這次加入的 paper id' },
      rejected: int('這次記錄為不收錄的篇數'),
      note: str('備註：下次可以考慮的候選、觀察到的缺口'),
    }, ['topic']),
    run: (args) => lib.logSearch(args),
  },
  atlas_search_history: {
    description: '過去的搜尋紀錄（新到舊）。找論文前先看，避免用同樣的查詢字串。',
    inputSchema: obj({ limit: int('最多回傳幾筆，預設 20') }),
    run: ({ limit }) => lib.searchHistory({ limit: limit || 20 }),
  },
  atlas_missing_references: {
    description: '被庫內 paper 引用、但文獻庫尚未收錄的文獻，依被引用的篇數排序。用於挑選下一批要收錄的候選，以及在研究建議中從參考文獻推薦。',
    inputSchema: obj({
      min_cited_by: int('至少被幾篇庫內 paper 引用，預設 1'),
      cited_by: { type: 'array', items: { type: 'string' }, description: '只看這些 paper id 的參考文獻' },
      limit: int('最多回傳幾筆，預設 50'),
    }),
    run: ({ min_cited_by, cited_by, limit }) => lib.missingReferences({ minCitedBy: min_cited_by || 1, citedBy: cited_by?.length ? cited_by : null, limit: limit || 50 }),
  },
  atlas_save_advice: {
    description: '儲存一份研究建議報告（Markdown）。預設存到 advice-private/，不進 git、不上網站；使用者明確要求公開時才設 publish 為 true。',
    inputSchema: obj({
      title: str('報告標題'), body: str('報告本文（Markdown，可用 [[paper-id]] 連結庫內 paper）'),
      stage: str('研究階段'), summary: str('一句話摘要'),
      publish: { type: 'boolean', description: '是否公開到網站，預設 false' },
    }, ['title', 'body']),
    run: (args) => lib.saveAdvice(args),
  },
  atlas_validate: {
    description: '檢查整個文獻庫：每篇的格式、重複收錄、關聯指向不存在的 paper。',
    inputSchema: obj({}),
    run: () => {
      const report = validateLibrary(loadPapers(), loadConfig());
      return { ok: report.errors.length === 0, ...report };
    },
  },
  atlas_build: {
    description: '驗證後重新產生網站資料（site/data/）。手動編輯過 data/ 或 config/ 之後呼叫。',
    inputSchema: obj({}),
    run: () => build(),
  },
};

const PROMPTS = {
  'find-papers': {
    description: '依主題找論文並加入文獻庫',
    arguments: [{ name: 'topic', description: '想找的主題或領域', required: true }, { name: 'count', description: '要幾篇（預設 5）', required: false }],
    text: (a) => `請依照下面的流程，找${a.count ? ` ${a.count} 篇` : ''}關於「${a.topic}」的論文並加入 Paper Atlas 文獻庫。\n\n${readSkill('find-papers')}`,
  },
  'research-advice': {
    description: '依研究題目與進度給建議',
    arguments: [{ name: 'research', description: '研究題目、目前階段、已完成的事、卡住的地方', required: true }],
    text: (a) => `我的研究狀況如下：\n\n${a.research}\n\n請依照下面的規則，從 Paper Atlas 文獻庫給我研究建議。\n\n${readPrompt('research-advice')}`,
  },
  'paper-intro': {
    description: '為一篇論文撰寫固定格式的介紹',
    arguments: [{ name: 'paper', description: '論文的標題、連結或 arXiv ID', required: true }],
    text: (a) => `請為這篇論文撰寫介紹並加入 Paper Atlas：${a.paper}\n\n先用 atlas_check_duplicate 確認尚未收錄，再依照下面的規則撰寫。\n\n${readPrompt('paper-intro')}`,
  },
};

function handle(method, params = {}) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {}, prompts: {} },
        serverInfo: SERVER,
        instructions: INSTRUCTIONS,
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) };
    case 'tools/call': {
      const tool = TOOLS[params.name];
      if (!tool) throw Object.assign(new Error(`沒有名為 ${params.name} 的工具`), { code: -32602 });
      try {
        const result = tool.run(params.arguments || {});
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
        return { content: [{ type: 'text', text }], isError: result && result.ok === false };
      } catch (error) {
        return { content: [{ type: 'text', text: `錯誤：${error.message}` }], isError: true };
      }
    }
    case 'prompts/list':
      return { prompts: Object.entries(PROMPTS).map(([name, p]) => ({ name, description: p.description, arguments: p.arguments })) };
    case 'prompts/get': {
      const prompt = PROMPTS[params.name];
      if (!prompt) throw Object.assign(new Error(`沒有名為 ${params.name} 的 prompt`), { code: -32602 });
      return { description: prompt.description, messages: [{ role: 'user', content: { type: 'text', text: prompt.text(params.arguments || {}) } }] };
    }
    default:
      throw Object.assign(new Error(`不支援的方法：${method}`), { code: -32601 });
  }
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  // Notifications (no id) never get a response.
  if (message.id === undefined || message.id === null) return;
  try {
    send({ jsonrpc: '2.0', id: message.id, result: handle(message.method, message.params) });
  } catch (error) {
    send({ jsonrpc: '2.0', id: message.id, error: { code: error.code || -32603, message: error.message } });
  }
});
