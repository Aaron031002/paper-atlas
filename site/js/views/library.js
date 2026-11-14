// The library: every paper as a row showing its category and one-line
// introduction first, with sorting, category filter and search.
import { esc, localDate, authorsShort, prefs, debounce } from '../util.js';

const SORTS = [
  { id: 'added-desc', label: '加入時間：新到舊', field: 'added_at', dir: -1, dateLabel: '加入' },
  { id: 'added-asc', label: '加入時間：舊到新', field: 'added_at', dir: 1, dateLabel: '加入' },
  { id: 'published-desc', label: '發表時間：新到舊', field: 'published', dir: -1, dateLabel: '發表' },
  { id: 'published-asc', label: '發表時間：舊到新', field: 'published', dir: 1, dateLabel: '發表' },
  { id: 'cited-desc', label: '被庫內引用次數', field: 'cited_by_count', dir: -1, dateLabel: '發表' },
  { id: 'title', label: '標題 A 到 Z', field: 'title', dir: 1, dateLabel: '發表' },
];

export function renderLibrary(main, ctx, { query }) {
  const { index } = ctx;
  const state = {
    sort: SORTS.some((s) => s.id === query.get('sort')) ? query.get('sort') : prefs.get('sort', 'added-desc'),
    category: query.get('category') || '',
    tag: query.get('tag') || '',
    q: query.get('q') || '',
  };
  if (!SORTS.some((s) => s.id === state.sort)) state.sort = 'added-desc';

  const counts = {};
  for (const p of index.papers) counts[p.category] = (counts[p.category] || 0) + 1;
  const usedCategories = index.categories.filter((c) => counts[c.id]);

  main.className = 'page page-library';
  main.innerHTML = `
    <aside class="legend" aria-label="分類">
      <h2 class="legend-title">分類</h2>
      <ul class="legend-list">
        <li><button type="button" class="legend-item" data-category="">
          <span class="legend-name">全部</span><span class="legend-count">${index.papers.length}</span>
        </button></li>
        ${usedCategories.map((c) => `
          <li><button type="button" class="legend-item" data-category="${esc(c.id)}" style="--cat:${esc(c.color)}" title="${esc(c.description || '')}">
            <span class="dot" aria-hidden="true"></span>
            <span class="legend-name">${esc(c.name)}</span><span class="legend-count">${counts[c.id]}</span>
          </button></li>`).join('')}
      </ul>
    </aside>
    <section class="library-main">
      <h1 class="visually-hidden">文獻庫</h1>
      <div class="toolbar">
        <label class="field field-search">
          <span class="visually-hidden">搜尋 paper</span>
          <input type="search" id="lib-search" placeholder="搜尋標題、作者、一句話介紹或 tag" value="${esc(state.q)}" autocomplete="off">
        </label>
        <label class="field field-sort">
          <span>排序</span>
          <select id="lib-sort">${SORTS.map((s) => `<option value="${s.id}">${s.label}</option>`).join('')}</select>
        </label>
      </div>
      <p class="result-line" id="lib-status" role="status"></p>
      <ol class="paper-list" id="lib-list"></ol>
    </section>`;

  const list = main.querySelector('#lib-list');
  const status = main.querySelector('#lib-status');
  const sortSelect = main.querySelector('#lib-sort');
  sortSelect.value = state.sort;

  function matches(p) {
    if (state.category && p.category !== state.category) return false;
    if (state.tag && !p.tags.includes(state.tag)) return false;
    if (!state.q.trim()) return true;
    const hay = [p.title, p.one_liner, p.authors.join(' '), p.tags.join(' '), p.venue, ctx.category(p.category).name].join(' ').toLowerCase();
    return state.q.toLowerCase().split(/\s+/).filter(Boolean).every((term) => hay.includes(term));
  }

  function draw() {
    const sort = SORTS.find((s) => s.id === state.sort);
    const papers = index.papers.filter(matches).sort((a, b) => {
      const av = a[sort.field];
      const bv = b[sort.field];
      const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return cmp * sort.dir || a.title.localeCompare(b.title);
    });

    main.querySelectorAll('.legend-item').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.category === state.category));
    });

    const filters = [];
    if (state.category) filters.push(ctx.category(state.category).name);
    if (state.tag) filters.push(`#${state.tag}`);
    if (state.q.trim()) filters.push(`「${state.q.trim()}」`);
    status.innerHTML = filters.length
      ? `${esc(filters.join('、'))}：${papers.length} 篇 <button type="button" class="link-button" id="lib-clear">清除篩選</button>`
      : `共 ${papers.length} 篇`;

    if (!papers.length) {
      list.innerHTML = `<li class="empty">${index.papers.length
        ? '沒有符合條件的 paper。換個關鍵字，或清除篩選。'
        : '文獻庫還是空的。請 agent 依照 find-papers skill 找第一批 paper。'}</li>`;
      return;
    }

    list.innerHTML = papers.map((p) => {
      const cat = ctx.category(p.category);
      const date = sort.field === 'added_at' ? localDate(p.added_at) : p.published;
      return `
        <li>
          <a class="paper-row" href="#/paper/${esc(p.id)}" style="--cat:${esc(cat.color)}">
            <div class="row-body">
              <span class="chip">${esc(cat.name)}</span>
              <p class="one-liner">${esc(p.one_liner)}</p>
              <h2 class="row-title">${esc(p.title)}</h2>
              <p class="row-meta">${esc(authorsShort(p.authors))}<span class="sep" aria-hidden="true"></span>${esc(p.venue)}</p>
              <ul class="tags" aria-label="tag">${p.tags.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
            </div>
            <div class="row-date"><span class="row-date-label">${sort.dateLabel}</span><time>${esc(date)}</time></div>
          </a>
        </li>`;
    }).join('');
  }

  function sync() {
    ctx.setQuery({ sort: state.sort === 'added-desc' ? '' : state.sort, category: state.category, tag: state.tag, q: state.q.trim() });
    draw();
  }

  main.querySelector('.legend').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.legend-item');
    if (!btn) return;
    state.category = btn.dataset.category;
    sync();
  });
  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; prefs.set('sort', state.sort); sync(); });
  main.querySelector('#lib-search').addEventListener('input', debounce((ev) => { state.q = ev.target.value; sync(); }, 120));
  status.addEventListener('click', (ev) => {
    if (ev.target.id !== 'lib-clear') return;
    state.category = ''; state.tag = ''; state.q = '';
    main.querySelector('#lib-search').value = '';
    sync();
  });

  draw();
}
