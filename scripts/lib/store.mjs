// File layout and read/write helpers. Every other module goes through here,
// so moving the data somewhere else (a database, another folder) only touches this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const PATHS = {
  config: path.join(ROOT, 'config', 'domain.json'),
  papers: path.join(ROOT, 'data', 'papers'),
  advice: path.join(ROOT, 'data', 'advice'),
  advicePrivate: path.join(ROOT, 'advice-private'),
  rejected: path.join(ROOT, 'data', 'ledger', 'rejected.json'),
  searchLog: path.join(ROOT, 'data', 'ledger', 'search-log.json'),
  prompts: path.join(ROOT, 'prompts'),
  site: path.join(ROOT, 'site'),
  siteData: path.join(ROOT, 'site', 'data'),
};

export function readJson(file, fallback) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`找不到檔案：${path.relative(ROOT, file)}`);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${path.relative(ROOT, file)} 不是合法的 JSON：${err.message}`);
  }
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export function loadConfig() {
  return readJson(PATHS.config);
}

/** All papers in the library, each tagged with the file it came from. */
export function loadPapers() {
  if (!fs.existsSync(PATHS.papers)) return [];
  return fs
    .readdirSync(PATHS.papers)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const paper = readJson(path.join(PATHS.papers, f));
      Object.defineProperty(paper, '__file', { value: f, enumerable: false });
      return paper;
    });
}

export function paperPath(id) {
  return path.join(PATHS.papers, `${id}.json`);
}

export function savePaper(paper) {
  writeJson(paperPath(paper.id), paper);
}

export function loadRejected() {
  return readJson(PATHS.rejected, []);
}

export function loadSearchLog() {
  return readJson(PATHS.searchLog, []);
}

/**
 * Advice reports are Markdown with a flat `key: value` header between --- lines.
 * Kept deliberately simple so no YAML parser is needed.
 */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

export function loadAdvice(dir = PATHS.advice) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .reverse()
    .map((f) => {
      const { meta, body } = parseFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      return { id: f.replace(/\.md$/, ''), ...meta, body };
    });
}

export function readPrompt(name) {
  const file = path.join(PATHS.prompts, `${name}.md`);
  if (!fs.existsSync(file)) {
    const available = fs.readdirSync(PATHS.prompts).map((f) => f.replace(/\.md$/, ''));
    throw new Error(`沒有名為「${name}」的 prompt。可用的有：${available.join('、')}`);
  }
  return fs.readFileSync(file, 'utf8');
}
