// Checks a paper record against the fixed format. The format itself lives in
// config/domain.json (categories, relation types, intro sections), so adding a
// section or a category there needs no change here.
import { findDuplicatePairs } from './identity.mjs';

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const KNOWN_KEYS = new Set([
  'id', 'title', 'authors', 'venue', 'year', 'published', 'added_at', 'added_by', 'ids', 'links',
  'category', 'tags', 'one_liner', 'intro', 'relations', 'references', 'references_complete', 'source',
]);

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isUrl = (v) => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);

/**
 * @returns {{errors: string[], warnings: string[]}} Errors block adding a paper; warnings do not.
 */
export function validatePaper(paper, config, { knownIds = null } = {}) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);
  const warn = (m) => warnings.push(m);

  if (!paper || typeof paper !== 'object' || Array.isArray(paper)) {
    return { errors: ['paper 必須是一個 JSON 物件'], warnings };
  }

  if (!isText(paper.id)) err('缺少 id');
  else if (!ID_PATTERN.test(paper.id)) err(`id「${paper.id}」格式不對：只能用小寫英數與連字號，例如 vaswani2017-attention`);

  if (!isText(paper.title)) err('缺少 title');

  if (!Array.isArray(paper.authors) || paper.authors.length === 0 || !paper.authors.every(isText)) {
    err('authors 必須是至少一位作者的字串陣列，依論文上的順序');
  }

  if (!isText(paper.venue)) err('缺少 venue（未正式發表請填 "arXiv preprint"）');

  if (!Number.isInteger(paper.year) || paper.year < 1900 || paper.year > 2100) err('year 必須是四位數整數');

  if (!isText(paper.published) || !DATE_PATTERN.test(paper.published)) {
    err('published 必須是 YYYY-MM-DD、YYYY-MM 或 YYYY（首次公開的日期）');
  } else if (Number.isInteger(paper.year) && Math.abs(Number(paper.published.slice(0, 4)) - paper.year) > 2) {
    warn(`published（${paper.published}）與 year（${paper.year}）相差超過兩年，請確認`);
  }

  if (paper.added_at !== undefined && (!isText(paper.added_at) || Number.isNaN(Date.parse(paper.added_at)))) {
    err('added_at 必須是 ISO 時間；通常不用自己填，add 指令會自動寫入');
  }

  const ids = paper.ids || {};
  if (typeof ids !== 'object' || Array.isArray(ids)) err('ids 必須是物件，例如 {"arxiv": "1706.03762", "doi": "10.x/y"}');
  else if (!isText(ids.arxiv) && !isText(ids.doi)) warn('ids 沒有 arxiv 也沒有 doi，去重只能靠標題，容易漏判');

  const links = paper.links || {};
  if (!isUrl(links.paper)) err('links.paper 必須是論文頁面的網址');
  for (const [k, v] of Object.entries(links)) {
    if (v !== null && v !== undefined && !isUrl(v)) err(`links.${k} 不是合法網址`);
  }

  const categoryIds = config.categories.map((c) => c.id);
  if (!categoryIds.includes(paper.category)) {
    err(`category「${paper.category}」不在設定中。可用的分類：${categoryIds.join('、')}`);
  }

  if (!Array.isArray(paper.tags) || !paper.tags.every(isText)) err('tags 必須是字串陣列');
  else {
    if (paper.tags.length < 2 || paper.tags.length > 8) warn('tags 建議 2 到 8 個');
    for (const t of paper.tags) {
      if (t !== t.toLowerCase() || /\s/.test(t)) err(`tag「${t}」格式不對：用小寫、以連字號取代空白，例如 dense-retrieval`);
    }
  }

  const maxLen = config.limits?.one_liner_max_chars ?? 60;
  if (!isText(paper.one_liner)) err('缺少 one_liner（一句話介紹）');
  else {
    if ([...paper.one_liner].length > maxLen) err(`one_liner 超過 ${maxLen} 個字（目前 ${[...paper.one_liner].length} 個字）`);
    if (/\n/.test(paper.one_liner)) err('one_liner 只能有一行');
  }

  // Intro sections, driven by config.
  const intro = paper.intro;
  if (!intro || typeof intro !== 'object' || Array.isArray(intro)) err('缺少 intro');
  else {
    for (const section of config.intro_sections) {
      const value = intro[section.key];
      const missing = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
      if (missing) {
        if (section.required) err(`intro.${section.key}（${section.label}）是必填`);
        continue;
      }
      if (section.type === 'bullets') {
        if (!Array.isArray(value) || !value.every(isText)) err(`intro.${section.key} 必須是字串陣列`);
        else {
          if (section.min && value.length < section.min) err(`intro.${section.key} 至少要 ${section.min} 點`);
          if (section.max && value.length > section.max) err(`intro.${section.key} 最多 ${section.max} 點`);
        }
      } else if (!isText(value)) {
        err(`intro.${section.key} 必須是文字（可用 Markdown）`);
      }
    }
    const known = new Set(config.intro_sections.map((s) => s.key));
    for (const key of Object.keys(intro)) {
      if (!known.has(key)) warn(`intro.${key} 不在 config 的 intro_sections 裡，網頁不會顯示`);
    }
  }

  const relationIds = config.relation_types.map((r) => r.id);
  if (paper.relations !== undefined) {
    if (!Array.isArray(paper.relations)) err('relations 必須是陣列');
    else {
      paper.relations.forEach((rel, i) => {
        if (!rel || !isText(rel.target)) return err(`relations[${i}] 缺少 target`);
        if (rel.target === paper.id) err(`relations[${i}] 不能指向自己`);
        if (!relationIds.includes(rel.type)) err(`relations[${i}].type「${rel.type}」不在設定中。可用：${relationIds.join('、')}`);
        if (!isText(rel.note)) err(`relations[${i}] 缺少 note（一句話說明兩篇的關係）`);
        if (knownIds && !knownIds.has(rel.target)) err(`relations[${i}].target「${rel.target}」不在文獻庫裡；只能關聯已收錄的 paper`);
      });
    }
  }

  if (!Array.isArray(paper.references)) err('references 必須是陣列（這篇 paper 引用的文獻）');
  else {
    if (paper.references.length === 0) warn('references 是空的；請至少列出主要參考文獻');
    paper.references.forEach((ref, i) => {
      if (!ref || !isText(ref.title)) return err(`references[${i}] 缺少 title`);
      if (ref.year !== undefined && ref.year !== null && !Number.isInteger(ref.year)) err(`references[${i}].year 必須是整數`);
      if (ref.url && !isUrl(ref.url)) err(`references[${i}].url 不是合法網址`);
    });
  }
  if (typeof paper.references_complete !== 'boolean') {
    err('references_complete 必須是 true 或 false（是否為完整的 reference 清單）');
  }

  const source = paper.source;
  if (!source || !isText(source.found_via)) err('缺少 source.found_via（從哪個來源找到的，對應 config 的 sources[].id）');

  for (const key of Object.keys(paper)) {
    if (!KNOWN_KEYS.has(key)) warn(`未知欄位「${key}」會被保留，但網頁不會顯示`);
  }

  return { errors, warnings };
}

/** Validate the whole library: each paper, plus cross-paper rules. */
export function validateLibrary(papers, config) {
  const knownIds = new Set(papers.map((p) => p.id));
  const report = { errors: [], warnings: [] };

  for (const paper of papers) {
    const label = paper.id || paper.__file || '(未命名)';
    const { errors, warnings } = validatePaper(paper, config, { knownIds });
    errors.forEach((m) => report.errors.push(`[${label}] ${m}`));
    warnings.forEach((m) => report.warnings.push(`[${label}] ${m}`));
    if (paper.__file && paper.id && paper.__file !== `${paper.id}.json`) {
      report.errors.push(`[${label}] 檔名 ${paper.__file} 與 id 不一致，應為 ${paper.id}.json`);
    }
    if (!paper.added_at) report.errors.push(`[${label}] 缺少 added_at；請用 add 指令新增 paper，不要手動建檔`);
  }

  for (const { a, b, key } of findDuplicatePairs(papers)) {
    report.errors.push(`重複收錄：${a} 與 ${b} 是同一篇（${key}）`);
  }

  const categoryIds = config.categories.map((c) => c.id);
  if (new Set(categoryIds).size !== categoryIds.length) report.errors.push('config：categories 的 id 重複');

  return report;
}
