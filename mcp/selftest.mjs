#!/usr/bin/env node
// Starts the MCP server, speaks the protocol to it, and checks the answers.
// Read-only: it never adds or changes papers. Run: node mcp/selftest.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'inherit'] });

const pending = new Map();
let buffer = '';
child.stdout.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const message = JSON.parse(buffer.slice(0, nl));
    buffer = buffer.slice(nl + 1);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});

let nextId = 1;
const request = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  const timer = setTimeout(() => reject(new Error(`${method} 逾時`)), 5000);
  pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
});
const call = async (name, args = {}) => {
  const res = await request('tools/call', { name, arguments: args });
  const text = res.result.content[0].text;
  let data = text;
  try { data = JSON.parse(text); } catch { /* plain text result */ }
  return { data, isError: res.result.isError };
};

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '通過' : '失敗'}  ${label}${detail ? `：${detail}` : ''}`);
  if (!ok) failed += 1;
};

try {
  const init = await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest', version: '0' } });
  check('initialize', init.result?.serverInfo?.name === 'paper-atlas', `protocol ${init.result?.protocolVersion}`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  const tools = (await request('tools/list')).result.tools;
  check('tools/list', tools.length >= 15 && tools.every((t) => t.inputSchema?.type === 'object'), `${tools.length} 個工具`);

  const overview = await call('atlas_overview');
  check('atlas_overview', typeof overview.data.paper_count === 'number', `${overview.data.paper_count} 篇`);

  const papers = (await call('atlas_list_papers', { sort: 'published-asc' })).data;
  check('atlas_list_papers', Array.isArray(papers));

  if (papers.length) {
    const first = papers[0];
    const paper = await call('atlas_get_paper', { id: first.id });
    check('atlas_get_paper', paper.data.id === first.id);
    const near = await call('atlas_neighbors', { id: first.id });
    check('atlas_neighbors', Array.isArray(near.data.relations_in) && Array.isArray(near.data.cited_by));
    const dup = await call('atlas_check_duplicate', { title: first.title.toUpperCase() });
    check('atlas_check_duplicate 擋下已收錄的 paper', dup.data.status === 'in_library', dup.data.matched_on);
    const again = await call('atlas_add_paper', { paper: paper.data });
    check('atlas_add_paper 拒絕重複', again.isError === true && again.data.ok === false, again.data.errors?.[0]);
  }

  const fresh = await call('atlas_check_duplicate', { title: 'A Title That Is Certainly Not In The Library 9f3a' });
  check('atlas_check_duplicate 放行新的 paper', fresh.data.status === 'new');

  const bad = await call('atlas_add_paper', { paper: { id: 'Bad Id', title: 'x' } });
  check('atlas_add_paper 拒絕格式錯誤', bad.isError === true && bad.data.errors.length > 3, `${bad.data.errors?.length} 個錯誤`);

  const prompt = await call('atlas_get_prompt', { name: 'paper-intro' });
  check('atlas_get_prompt', typeof prompt.data === 'string' && prompt.data.includes('one_liner'));

  const skill = await call('atlas_get_skill', { name: 'find-papers' });
  check('atlas_get_skill', typeof skill.data === 'string' && skill.data.includes('check'));

  const context = await call('atlas_library_context');
  check('atlas_library_context', typeof context.data === 'string');

  const refs = await call('atlas_missing_references', { min_cited_by: 2 });
  check('atlas_missing_references', Array.isArray(refs.data), `${refs.data.length} 筆`);

  const validate = await call('atlas_validate');
  check('atlas_validate', validate.data.ok === true, `${validate.data.errors?.length} 個錯誤`);

  const prompts = (await request('prompts/list')).result.prompts;
  check('prompts/list', prompts.length === 3);

  const unknown = await request('no/such/method');
  check('未知方法回傳錯誤', unknown.error?.code === -32601);
} catch (error) {
  check('selftest', false, error.message);
} finally {
  child.kill();
}

console.log(failed ? `\n${failed} 項失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
