#!/usr/bin/env node
// Paper Atlas command line. No dependencies: `node scripts/atlas.mjs <command>`.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import * as lib from './lib/library.mjs';
import { build } from './lib/build.mjs';
import { validateLibrary } from './lib/validate.mjs';
import { PATHS, loadConfig, loadPapers, readPrompt } from './lib/store.mjs';

const HELP = `Paper Atlas CLI

用法：node scripts/atlas.mjs <command> [options]

查詢
  overview                          文獻庫概況：領域、分類、篇數、最近加入
  list [--category id] [--tag t] [--sort added-desc|added-asc|published-desc|published-asc|title]
  show <id>                         一篇 paper 的完整紀錄
  neighbors <id>                    與這篇有關的庫內 paper：雙向的關聯、引用、被引用、共用 tag
  search <關鍵字…> [--limit n]       在文獻庫裡搜尋
  context                           給 LLM 讀的精簡總覽（每篇一行 + 關聯）
  refs [--min-cited-by n] [--cited-by id,id] [--limit n]
                                    被庫內 paper 引用、但尚未收錄的文獻
  history [--limit n]               過去的搜尋紀錄
  prompt <paper-intro|research-advice>   印出 prompt 全文

新增（每次找 paper 都要照這個順序）
  check --title "…" [--arxiv id] [--doi id]
                                    檢查是否已收錄或曾被拒絕；exit 0 = 新的，1 = 已收錄，2 = 曾拒絕
  add <file.json> [--by name] [--override-rejected]
                                    驗證格式 + 去重後寫入 data/papers/
  reject --title "…" --reason "…" [--arxiv id] [--doi id] [--topic "…"]
                                    記錄評估後不收錄的 paper，下次不再重看
  log-search --topic "…" [--queries "a;b"] [--sources "arxiv,semantic-scholar"] [--added id,id] [--rejected n] [--note "…"]

研究建議
  save-advice <file.md | -> --title "…" [--stage "…"] [--summary "…"] [--publish]
                                    預設存到 advice-private/（不進 git）；--publish 才會出現在網站
                                    檔名給 - 表示從標準輸入讀取報告本文

維護
  validate                          檢查所有 paper 的格式、重複與關聯
  build                             validate 後產生 site/data/（網站讀的資料）
  serve [--port 4173]               build 後在本機預覽網站

所有指令加上 --json 會輸出 JSON。`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i += 1; }
    } else positional.push(arg);
  }
  return { positional, flags };
}

const list = (value, sep = ',') => (typeof value === 'string' ? value.split(sep).map((s) => s.trim()).filter(Boolean) : []);
const out = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

function printCards(cards) {
  if (cards.length === 0) return out('（沒有符合的 paper）');
  for (const c of cards) {
    out(`${c.id}\n  [${c.category}] ${c.one_liner}\n  ${c.title}（${c.venue}，發表 ${c.published}，加入 ${String(c.added_at).slice(0, 10)}）`);
  }
}

function serve(port) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
  http
    .createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let file = path.normalize(path.join(PATHS.site, urlPath));
      if (!file.startsWith(PATHS.site)) { res.writeHead(403); return res.end(); }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    })
    .listen(port, () => console.log(`Paper Atlas 預覽：http://localhost:${port}`));
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  const json = Boolean(flags.json);

  switch (command) {
    case 'overview': return out(lib.overview());
    case 'list': {
      const cards = lib.listPapers({ category: flags.category, tag: flags.tag, sort: flags.sort || 'added-desc' });
      return json ? out(cards) : printCards(cards);
    }
    case 'show': return out(lib.getPaper(positional[0]));
    case 'neighbors': return out(lib.neighbors(positional[0]));
    case 'search': {
      const cards = lib.searchPapers(positional.join(' '), { limit: Number(flags.limit) || 10 });
      return json ? out(cards) : printCards(cards);
    }
    case 'context': return out(lib.libraryContext());
    case 'refs': {
      const refs = lib.missingReferences({
        minCitedBy: Number(flags['min-cited-by']) || 1,
        citedBy: flags['cited-by'] ? list(flags['cited-by']) : null,
        limit: Number(flags.limit) || 50,
      });
      if (json) return out(refs);
      if (refs.length === 0) return out('（沒有符合的參考文獻）');
      for (const r of refs) {
        const id = r.arxiv ? `arXiv:${r.arxiv}` : r.doi ? `doi:${r.doi}` : '無 ID';
        out(`被 ${r.cited_by.length} 篇引用｜${r.title}（${r.year ?? '年份不明'}，${id}）\n  引用它的：${r.cited_by.join('、')}`);
      }
      return undefined;
    }
    case 'history': return out(lib.searchHistory({ limit: Number(flags.limit) || 20 }));
    case 'prompt': return out(readPrompt(positional[0]));
    case 'check': {
      const result = lib.checkDuplicate({ title: flags.title, arxiv: flags.arxiv, doi: flags.doi });
      out(result);
      process.exitCode = { new: 0, in_library: 1, rejected_before: 2 }[result.status];
      return undefined;
    }
    case 'add': {
      if (!positional[0]) throw new Error('用法：add <file.json>');
      const input = JSON.parse(fs.readFileSync(positional[0], 'utf8'));
      const result = lib.addPaper(input, {
        by: typeof flags.by === 'string' ? flags.by : 'agent',
        overrideRejected: Boolean(flags['override-rejected']),
        keepAddedAt: Boolean(flags['keep-added-at']),
      });
      out(result);
      if (!result.ok) process.exitCode = 1;
      return undefined;
    }
    case 'reject': {
      const result = lib.rejectPaper({ title: flags.title, arxiv: flags.arxiv, doi: flags.doi, reason: flags.reason, topic: flags.topic });
      out(result);
      if (!result.ok) process.exitCode = 1;
      return undefined;
    }
    case 'log-search':
      return out(lib.logSearch({
        topic: flags.topic, queries: list(flags.queries, ';'), sources: list(flags.sources),
        added: list(flags.added), rejected: Number(flags.rejected) || 0, note: flags.note,
      }));
    case 'save-advice': {
      if (!positional[0]) throw new Error('用法：save-advice <file.md> --title "…"');
      return out(lib.saveAdvice({
        title: flags.title, stage: flags.stage || '', summary: flags.summary || '',
        body: fs.readFileSync(positional[0] === '-' ? 0 : positional[0], 'utf8'), publish: Boolean(flags.publish),
      }));
    }
    case 'validate': {
      const report = validateLibrary(loadPapers(), loadConfig());
      report.warnings.forEach((w) => console.warn(`警告  ${w}`));
      report.errors.forEach((e) => console.error(`錯誤  ${e}`));
      out(report.errors.length ? `驗證失敗：${report.errors.length} 個錯誤` : `驗證通過（${loadPapers().length} 篇，${report.warnings.length} 個警告）`);
      if (report.errors.length) process.exitCode = 1;
      return undefined;
    }
    case 'build': {
      const result = build();
      if (!result.ok) {
        result.errors.forEach((e) => console.error(`錯誤  ${e}`));
        out(`build 失敗：${result.errors.length} 個錯誤`);
        process.exitCode = 1;
        return undefined;
      }
      result.warnings.forEach((w) => console.warn(`警告  ${w}`));
      return out(`已產生 ${result.output}：${result.papers} 篇 paper、圖譜 ${result.graph_nodes} 個節點 / ${result.graph_edges} 條邊、${result.advice_reports} 份建議報告`);
    }
    case 'serve': {
      const result = build();
      if (!result.ok) { result.errors.forEach((e) => console.error(`錯誤  ${e}`)); process.exitCode = 1; return undefined; }
      return serve(Number(flags.port) || 4173);
    }
    case undefined:
    case 'help':
    case '--help':
      return out(HELP);
    default:
      throw new Error(`不認得的指令「${command}」。執行 node scripts/atlas.mjs help 看所有指令。`);
  }
}

try {
  main();
} catch (error) {
  console.error(`錯誤：${error.message}`);
  process.exitCode = 1;
}
