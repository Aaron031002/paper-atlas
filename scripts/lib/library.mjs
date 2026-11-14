// The operations an agent or a person performs on the library. The CLI
// (scripts/atlas.mjs) and the MCP server (mcp/server.mjs) are thin wrappers
// around these functions, so a new capability is added once, here.
import fs from 'node:fs';
import path from 'node:path';
import {
  PATHS, ROOT, loadConfig, loadPapers, loadRejected, loadSearchLog, loadAdvice,
  paperPath, savePaper, writeJson,
} from './store.mjs';
import {
  buildIdentityIndex, findInLibrary, findRejected, identityKeys, normalizeTitle,
} from './identity.mjs';
import { validatePaper } from './validate.mjs';

const FIELD_ORDER = [
  'id', 'title', 'authors', 'venue', 'year', 'published', 'added_at', 'added_by', 'ids', 'links',
  'category', 'tags', 'one_liner', 'intro', 'relations', 'references', 'references_complete', 'source',
];

function ordered(paper) {
  const out = {};
  for (const key of FIELD_ORDER) if (paper[key] !== undefined) out[key] = paper[key];
  for (const key of Object.keys(paper)) if (!(key in out)) out[key] = paper[key];
  return out;
}

/** Today's date on this machine's clock (not UTC), as YYYY-MM-DD. */
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const card = (p) => ({
  id: p.id, title: p.title, year: p.year, venue: p.venue, published: p.published,
  added_at: p.added_at, category: p.category, tags: p.tags, one_liner: p.one_liner,
});

const SORTERS = {
  'added-desc': (a, b) => String(b.added_at).localeCompare(String(a.added_at)),
  'added-asc': (a, b) => String(a.added_at).localeCompare(String(b.added_at)),
  'published-desc': (a, b) => String(b.published).localeCompare(String(a.published)),
  'published-asc': (a, b) => String(a.published).localeCompare(String(b.published)),
  title: (a, b) => a.title.localeCompare(b.title),
};

export function overview() {
  const config = loadConfig();
  const papers = loadPapers();
  const byCategory = {};
  for (const p of papers) byCategory[p.category] = (byCategory[p.category] || 0) + 1;
  return {
    site: config.site.name,
    domain: config.domain,
    paper_count: papers.length,
    categories: config.categories.map((c) => ({ id: c.id, name: c.name, description: c.description, papers: byCategory[c.id] || 0 })),
    relation_types: config.relation_types,
    latest_added: [...papers].sort(SORTERS['added-desc']).slice(0, 5).map(card),
    rejected_count: loadRejected().length,
    search_runs: loadSearchLog().length,
  };
}

export function listPapers({ category, tag, sort = 'added-desc' } = {}) {
  let papers = loadPapers();
  if (category) papers = papers.filter((p) => p.category === category);
  if (tag) papers = papers.filter((p) => p.tags.includes(tag));
  if (!SORTERS[sort]) throw new Error(`不支援的排序「${sort}」。可用：${Object.keys(SORTERS).join('、')}`);
  return papers.sort(SORTERS[sort]).map(card);
}

export function getPaper(id) {
  const file = paperPath(id);
  if (!fs.existsSync(file)) throw new Error(`文獻庫裡沒有 id 為「${id}」的 paper。用 list 或 search 查詢現有的 id。`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Keyword search over the library. Returns cards with a relevance score, best first. */
export function searchPapers(query, { limit = 10 } = {}) {
  const terms = normalizeTitle(query).split(' ').filter(Boolean);
  if (terms.length === 0) return [];
  const results = [];
  for (const p of loadPapers()) {
    const fields = [
      [5, p.title], [4, p.tags.join(' ')], [3, p.one_liner], [2, p.authors.join(' ')],
      [2, (p.intro?.tldr || []).join(' ')],
      [1, Object.values(p.intro || {}).flat().join(' ')],
    ].map(([w, text]) => [w, normalizeTitle(text)]);
    let score = 0;
    let matched = 0;
    for (const term of terms) {
      let best = 0;
      for (const [w, text] of fields) if (text.includes(term)) best = Math.max(best, w);
      if (best) matched += 1;
      score += best;
    }
    if (matched) results.push({ ...card(p), score, matched_terms: `${matched}/${terms.length}` });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Has this paper been handled before? Call this for every candidate before
 * writing an introduction for it.
 * status: "new" | "in_library" | "rejected_before"
 */
export function checkDuplicate({ title, arxiv, doi }) {
  if (!title && !arxiv && !doi) throw new Error('至少要提供 title、arxiv 或 doi 其中一項');
  const record = { title, arxiv, doi };
  const hit = findInLibrary(record, buildIdentityIndex(loadPapers()));
  if (hit) {
    return { status: 'in_library', matched_on: hit.matchedOn, paper: card(hit.paper), message: '這篇已經收錄，不要重複新增。' };
  }
  const rejected = findRejected(record, loadRejected());
  if (rejected) {
    return { status: 'rejected_before', matched_on: rejected.matchedOn, entry: rejected.entry, message: '這篇先前評估後決定不收錄，除非使用者明確要求，否則跳過。' };
  }
  return { status: 'new', message: '尚未收錄，可以繼續。' };
}

/**
 * Add a paper. Refuses duplicates and anything that fails validation.
 * `added_at` is always set here so the "time added" sort cannot be faked.
 */
export function addPaper(input, { by = 'agent', overrideRejected = false, keepAddedAt = false } = {}) {
  const config = loadConfig();
  const papers = loadPapers();
  const paper = { ...input };
  if (!keepAddedAt || !paper.added_at) paper.added_at = new Date().toISOString();
  paper.added_by = paper.added_by || by;
  paper.relations = paper.relations || [];

  const knownIds = new Set(papers.map((p) => p.id));
  const { errors, warnings } = validatePaper(paper, config, { knownIds });

  if (paper.id && knownIds.has(paper.id)) errors.push(`id「${paper.id}」已被使用，請換一個（若是同一篇 paper 則不該再新增）`);
  const index = buildIdentityIndex(papers);
  const dup = findInLibrary(paper, index);
  if (dup) errors.push(`重複：這篇已收錄為「${dup.paper.id}」（比對到 ${dup.matchedOn}）`);
  const rejected = findRejected(paper, loadRejected());
  if (rejected && !overrideRejected) {
    errors.push(`這篇先前被評估為不收錄（原因：${rejected.entry.reason}）。若使用者明確要求收錄，加上 override_rejected 再試。`);
  }

  if (errors.length) return { ok: false, errors, warnings };

  savePaper(ordered(paper));

  const citesInLibrary = paper.references
    .map((ref) => findInLibrary(ref, index))
    .filter(Boolean)
    .map((h) => h.paper.id);
  const ownKeys = new Set(identityKeys(paper));
  const citedByInLibrary = papers
    .filter((p) => p.references.some((ref) => identityKeys(ref).some((k) => ownKeys.has(k))))
    .map((p) => p.id);

  return {
    ok: true,
    id: paper.id,
    file: path.relative(ROOT, paperPath(paper.id)),
    warnings,
    cites_in_library: [...new Set(citesInLibrary)],
    cited_by_in_library: citedByInLibrary,
    next: '執行 build 重新產生網站資料，然後 git commit 與 push。',
  };
}

/** Record a candidate that was examined and not added, so it is not re-examined next time. */
export function rejectPaper({ title, arxiv, doi, reason, topic }) {
  if (!title) throw new Error('需要 title');
  if (!reason) throw new Error('需要 reason（為什麼不收錄）');
  const check = checkDuplicate({ title, arxiv, doi });
  if (check.status !== 'new') return { ok: false, ...check };
  const rejected = loadRejected();
  const entry = { title, arxiv: arxiv || null, doi: doi || null, reason, topic: topic || null, date: today() };
  rejected.push(entry);
  writeJson(PATHS.rejected, rejected);
  return { ok: true, entry };
}

/** Record one search run: what was asked for, where it was searched, what came of it. */
export function logSearch({ topic, queries = [], sources = [], added = [], rejected = 0, note }) {
  if (!topic) throw new Error('需要 topic');
  const log = loadSearchLog();
  const entry = { date: new Date().toISOString(), topic, queries, sources, added, rejected, note: note || null };
  log.push(entry);
  writeJson(PATHS.searchLog, log);
  return { ok: true, entry, total_runs: log.length };
}

export function searchHistory({ limit = 20 } = {}) {
  return loadSearchLog().slice(-limit).reverse();
}

/**
 * References that library papers cite but the library does not contain.
 * Sorted by how many library papers cite them: the top entries are the
 * strongest candidates to add next, and to recommend in research advice.
 */
export function missingReferences({ minCitedBy = 1, citedBy = null, limit = 50 } = {}) {
  const papers = loadPapers();
  const index = buildIdentityIndex(papers);
  const groups = new Map(); // identity key -> group
  const all = [];
  for (const paper of papers) {
    if (citedBy && !citedBy.includes(paper.id)) continue;
    for (const ref of paper.references) {
      if (findInLibrary(ref, index)) continue;
      const keys = identityKeys(ref);
      let group = keys.map((k) => groups.get(k)).find(Boolean);
      if (!group) {
        group = { title: ref.title, authors: ref.authors || null, year: ref.year ?? null, arxiv: ref.arxiv || null, doi: ref.doi || null, url: ref.url || null, cited_by: [] };
        all.push(group);
      }
      for (const k of keys) groups.set(k, group);
      group.arxiv = group.arxiv || ref.arxiv || null;
      group.doi = group.doi || ref.doi || null;
      if (!group.cited_by.includes(paper.id)) group.cited_by.push(paper.id);
    }
  }
  return all
    .filter((g) => g.cited_by.length >= minCitedBy)
    .sort((a, b) => b.cited_by.length - a.cited_by.length || (b.year || 0) - (a.year || 0))
    .slice(0, limit);
}

/**
 * Everything in the library connected to one paper, in both directions:
 * explicit relations, citations, and papers sharing a tag.
 */
export function neighbors(id) {
  const papers = loadPapers();
  const paper = papers.find((p) => p.id === id);
  if (!paper) throw new Error(`文獻庫裡沒有 id 為「${id}」的 paper。用 list 或 search 查詢現有的 id。`);
  const index = buildIdentityIndex(papers);
  const ownKeys = new Set(identityKeys(paper));
  const title = (pid) => papers.find((p) => p.id === pid)?.title;
  const cites = [...new Set(paper.references.map((ref) => findInLibrary(ref, index)?.paper.id).filter((pid) => pid && pid !== id))];
  const citedBy = papers
    .filter((p) => p.id !== id && p.references.some((ref) => identityKeys(ref).some((k) => ownKeys.has(k))))
    .map((p) => p.id);
  const sharedTags = {};
  for (const p of papers) {
    if (p.id === id) continue;
    const common = p.tags.filter((t) => paper.tags.includes(t));
    if (common.length) sharedTags[p.id] = common;
  }
  return {
    id,
    title: paper.title,
    relations_out: (paper.relations || []).map((r) => ({ ...r, title: title(r.target) })),
    relations_in: papers.flatMap((p) => (p.relations || []).filter((r) => r.target === id).map((r) => ({ source: p.id, title: p.title, type: r.type, note: r.note }))),
    cites: cites.map((pid) => ({ id: pid, title: title(pid) })),
    cited_by: citedBy.map((pid) => ({ id: pid, title: title(pid) })),
    shares_tags_with: Object.entries(sharedTags).map(([pid, tags]) => ({ id: pid, title: title(pid), tags })),
  };
}

/**
 * A compact, token-cheap view of the whole library for an LLM to reason over:
 * one line per paper, plus relations. Read this before the full records.
 */
export function libraryContext() {
  const config = loadConfig();
  const papers = loadPapers().sort(SORTERS['published-asc']);
  const lines = [
    `# ${config.site.name}：${config.domain.name}（共 ${papers.length} 篇）`,
    '',
    '格式：id | 年份 | 分類 | 標題 | 一句話介紹 | tags',
    '',
    ...papers.map((p) => `${p.id} | ${p.year} | ${p.category} | ${p.title} | ${p.one_liner} | ${p.tags.join(', ')}`),
    '',
    '## 關聯（來源 -[類型]-> 目標：說明）',
    ...papers.flatMap((p) => (p.relations || []).map((r) => `${p.id} -[${r.type}]-> ${r.target}：${r.note}`)),
  ];
  return lines.join('\n');
}

/**
 * Save a research-advice report. Private by default (advice-private/ is
 * git-ignored); publish:true puts it in data/advice/ where the website shows it.
 */
export function saveAdvice({ title, stage = '', summary = '', body, publish = false }) {
  if (!title || !body) throw new Error('需要 title 與 body');
  const knownIds = new Set(loadPapers().map((p) => p.id));
  const linked = [...body.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]);
  const unknown = [...new Set(linked.filter((id) => !knownIds.has(id)))];
  const date = today();
  // File name: letters and digits of any script (Chinese titles stay readable), words joined by hyphens.
  const slug = [...normalizeTitle(title).replace(/\s+/g, '-')].slice(0, 40).join('').replace(/-+$/, '') || `advice-${Date.now().toString(36)}`;
  const dir = publish ? PATHS.advice : PATHS.advicePrivate;
  fs.mkdirSync(dir, { recursive: true });
  let id = `${date}-${slug}`;
  for (let n = 2; fs.existsSync(path.join(dir, `${id}.md`)); n += 1) id = `${date}-${slug}-${n}`;
  const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
  const used = [...new Set(linked.filter((id) => knownIds.has(id)))];
  const text = `---\ntitle: ${oneLine(title)}\ncreated: ${date}\nstage: ${oneLine(stage)}\nsummary: ${oneLine(summary)}\npapers: ${used.join(', ')}\n---\n\n${body.trim()}\n`;
  fs.writeFileSync(path.join(dir, `${id}.md`), text);
  return {
    ok: true,
    id,
    file: path.relative(ROOT, path.join(dir, `${id}.md`)),
    published: publish,
    papers_linked: used,
    warnings: unknown.length ? [`報告裡的 [[${unknown.join(']]、[[')}]] 不是文獻庫裡的 id，網頁上不會變成連結`] : [],
  };
}

export function listAdvice() {
  return loadAdvice().map(({ body, ...meta }) => meta);
}
