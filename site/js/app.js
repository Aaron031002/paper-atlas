// Entry point: loads the library index, then shows the view named by the URL hash.
// To add a page: write views/<name>.js exporting render(container, ctx),
// add it to ROUTES below, and add a link in index.html.
import { renderLibrary } from './views/library.js';
import { renderPaper } from './views/paper.js';
import { renderGraph } from './views/graph.js';
import { renderAdvice } from './views/advice.js';
import { renderGuide } from './views/guide.js';
import { esc } from './util.js';

const ROUTES = [
  { pattern: /^$/, nav: 'library', render: renderLibrary },
  { pattern: /^paper\/([^/]+)$/, nav: 'library', render: renderPaper },
  { pattern: /^graph$/, nav: 'graph', render: renderGraph },
  { pattern: /^advice(?:\/([^/]+))?$/, nav: 'advice', render: renderAdvice },
  { pattern: /^guide$/, nav: 'guide', render: renderGuide },
];

const main = document.getElementById('main');
const cache = new Map();
let index = null;
let cleanup = null;

async function fetchJson(url) {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then((res) => {
      if (!res.ok) throw new Error(`讀取 ${url} 失敗（${res.status}）`);
      return res.json();
    }));
  }
  return cache.get(url);
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { path: path.replace(/\/$/, ''), query: new URLSearchParams(query) };
}

const ctx = {
  get index() { return index; },
  get papers() { return ctx.paperMap; },
  getPaper: (id) => fetchJson(`data/papers/${encodeURIComponent(id)}.json`),
  getAdvice: () => fetchJson('data/advice.json'),
  category: (id) => index.categories.find((c) => c.id === id) || { id, name: id, color: '#5b6678' },
  relationLabel: (id) => index.relation_types.find((r) => r.id === id)?.label || id,
  /** Update the query part of the hash without re-rendering the page. */
  setQuery(params) {
    const { path } = parseHash();
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) query.set(k, v);
    const qs = query.toString();
    history.replaceState(null, '', `#/${path}${qs ? `?${qs}` : ''}`);
  },
};

async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  const { path, query } = parseHash();
  const match = ROUTES.map((r) => ({ r, m: r.pattern.exec(path) })).find((x) => x.m);
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (match && a.dataset.nav === match.r.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  main.className = '';
  if (!match) {
    main.innerHTML = `<div class="notice"><h1>找不到這個頁面</h1><p><a href="#/">回到文獻庫</a></p></div>`;
    return;
  }
  try {
    cleanup = (await match.r.render(main, ctx, { params: match.m.slice(1).map((p) => p && decodeURIComponent(p)), query })) || null;
  } catch (error) {
    main.innerHTML = `<div class="notice"><h1>這一頁載入失敗</h1><p>${esc(error.message)}</p><p><a href="#/">回到文獻庫</a></p></div>`;
  }
  window.scrollTo(0, 0);
}

async function start() {
  try {
    index = await fetchJson('data/index.json');
  } catch (error) {
    main.innerHTML = `<div class="notice"><h1>還沒有網站資料</h1><p>請先在專案根目錄執行 <code>node scripts/atlas.mjs build</code> 產生 <code>site/data/</code>。</p><p class="muted">${esc(error.message)}</p></div>`;
    return;
  }
  ctx.paperMap = new Map(index.papers.map((p) => [p.id, p]));
  document.title = `${index.site.name}：${index.domain.name}`;
  document.getElementById('brand-domain').textContent = index.domain.name;
  window.addEventListener('hashchange', route);
  route();
}

start();
