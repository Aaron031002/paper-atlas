// Knowledge graph page: turns the library's graph data into nodes and edges for
// the engine, and owns the legend, layer toggles, search box and detail panel.
import { ForceGraph } from '../graph/engine.js';
import { esc, referenceUrl } from '../util.js';
import { shortTitle } from '../md.js';

export function renderGraph(main, ctx, { query }) {
  const { index } = ctx;
  const graph = index.graph;
  const counts = {};
  for (const p of index.papers) counts[p.category] = (counts[p.category] || 0) + 1;
  const usedCategories = index.categories.filter((c) => counts[c.id]);
  const tagCount = graph.nodes.filter((n) => n.type === 'tag').length;
  const refCount = graph.nodes.filter((n) => n.type === 'ref').length;

  const state = {
    hiddenCategories: new Set(),
    showTags: true,
    showRefs: false,
  };

  main.className = 'page-graph';
  main.innerHTML = `
    <h1 class="visually-hidden">知識圖譜</h1>
    <canvas id="graph-canvas" tabindex="0" aria-label="文獻知識圖譜。拖曳節點可移動，拖曳空白處平移，滾輪縮放。方向鍵平移，加減號縮放，0 回到全覽。下方的搜尋框可以直接跳到某個節點。"></canvas>

    <details class="graph-panel graph-legend" open>
      <summary>圖例與篩選</summary>
      <label class="field field-search">
        <span class="visually-hidden">尋找節點</span>
        <input type="search" id="graph-find" list="graph-nodes" placeholder="尋找 paper 或概念" autocomplete="off">
        <datalist id="graph-nodes">${graph.nodes.map((n) => `<option value="${esc(n.label)}"></option>`).join('')}</datalist>
      </label>
      <ul class="legend-list" id="graph-categories">
        ${usedCategories.map((c) => `
          <li><button type="button" class="legend-item" data-category="${esc(c.id)}" aria-pressed="true" style="--cat:${esc(c.color)}">
            <span class="dot" aria-hidden="true"></span><span class="legend-name">${esc(c.name)}</span><span class="legend-count">${counts[c.id]}</span>
          </button></li>`).join('')}
      </ul>
      <div class="layer-toggles">
        <label><input type="checkbox" id="layer-tags" checked ${tagCount ? '' : 'disabled'}>
          <span class="key key-tag" aria-hidden="true"></span>共用概念（${tagCount}）</label>
        <label><input type="checkbox" id="layer-refs" ${refCount ? '' : 'disabled'}>
          <span class="key key-ref" aria-hidden="true"></span>常被引用但尚未收錄（${refCount}）</label>
        <label><input type="checkbox" id="pin-on-drop">拖曳後固定在放開的位置</label>
      </div>
      <ul class="edge-key">
        <li><span class="key key-relation" aria-hidden="true"></span>明確關聯（延伸、比較…）</li>
        <li><span class="key key-cites" aria-hidden="true"></span>引用</li>
      </ul>
    </details>

    <div class="graph-panel graph-controls" role="group" aria-label="檢視控制">
      <button type="button" data-action="zoom-in" aria-label="放大">＋</button>
      <button type="button" data-action="zoom-out" aria-label="縮小">－</button>
      <button type="button" data-action="fit">全覽</button>
      <button type="button" data-action="relax">重新排列</button>
    </div>

    <aside class="graph-panel graph-detail" id="graph-detail" aria-live="polite" hidden></aside>`;

  const canvas = main.querySelector('#graph-canvas');
  const detail = main.querySelector('#graph-detail');
  const paperNode = new Map(graph.nodes.filter((n) => n.type === 'paper').map((n) => [n.id, n]));

  const engine = new ForceGraph(canvas, { onSelect: showDetail });
  const wide = window.matchMedia('(min-width: 900px)');
  // Keep the graph clear of the legend (left) and, once open, the detail panel (right).
  const setInsets = () => {
    const open = !detail.hidden;
    engine.insets = {
      left: wide.matches ? 290 : 0,
      right: wide.matches && open ? 350 : 0,
      bottom: !wide.matches && open ? Math.min(detail.offsetHeight + 16, canvas.clientHeight * 0.5) : 0,
    };
  };
  setInsets();

  function visibleData() {
    const nodes = graph.nodes.filter((n) => {
      if (n.type === 'paper') return !state.hiddenCategories.has(n.category);
      if (n.type === 'tag') return state.showTags;
      return state.showRefs;
    });
    const ids = new Set(nodes.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    // A concept or reference whose papers are all hidden would float alone: drop it.
    const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
    const inbound = {};
    for (const e of edges) if (e.type === 'cites' || e.type === 'relation') inbound[e.target] = (inbound[e.target] || 0) + 1;

    return {
      nodes: nodes.filter((n) => n.type === 'paper' || linked.has(n.id)).map((n) => ({
        id: n.id,
        kind: n.type,
        label: n.label,
        shortLabel: n.type === 'paper' ? shortTitle(n.label) : n.type === 'ref' ? shortTitle(n.label) : n.label,
        color: n.type === 'paper' ? ctx.category(n.category).color : null,
        weight: inbound[n.id] || 0,
      })),
      edges: edges.map((e) => ({
        source: e.source,
        target: e.target,
        kind: e.type,
        directed: e.type === 'relation' || e.type === 'cites',
        label: e.type === 'relation' ? ctx.relationLabel(e.relation) : null,
      })),
    };
  }

  function refresh() {
    const { nodes, edges } = visibleData();
    engine.setData(nodes, edges);
  }

  function connections(id) {
    const out = { relations: [], cites: [], citedBy: [], tags: [], refs: [] };
    for (const e of graph.edges) {
      if (e.source !== id && e.target !== id) continue;
      const other = e.source === id ? e.target : e.source;
      if (e.type === 'relation') out.relations.push({ other, outgoing: e.source === id, relation: e.relation, note: e.note });
      else if (e.type === 'cites') (e.source === id ? out.cites : out.citedBy).push(other);
      else if (e.type === 'tag') out.tags.push(other);
      else out.refs.push(other);
    }
    return out;
  }

  const nodeButton = (id) => {
    const p = paperNode.get(id);
    return p ? `<button type="button" class="link-button" data-focus="${esc(id)}">${esc(p.label)}</button>` : esc(id);
  };

  function showDetail(node) {
    if (!node) { detail.hidden = true; detail.innerHTML = ''; setInsets(); return; }
    const raw = graph.nodes.find((n) => n.id === node.id);
    const c = connections(node.id);
    let html = '';

    if (raw.type === 'paper') {
      const cat = ctx.category(raw.category);
      html = `
        <span class="chip" style="--cat:${esc(cat.color)}">${esc(cat.name)}</span>
        <p class="one-liner">${esc(raw.one_liner)}</p>
        <h2>${esc(raw.label)}</h2>
        <a class="button" href="#/paper/${esc(raw.id)}">閱讀介紹</a>
        ${c.relations.length ? `<h3>關聯</h3><ul class="detail-list">${c.relations.map((r) => `
          <li><span class="rel-type">${r.outgoing ? '' : '被 '}${esc(ctx.relationLabel(r.relation))}</span> ${nodeButton(r.other)}<p>${esc(r.note)}</p></li>`).join('')}</ul>` : ''}
        ${c.cites.length ? `<h3>引用了</h3><ul class="detail-list">${c.cites.map((id) => `<li>${nodeButton(id)}</li>`).join('')}</ul>` : ''}
        ${c.citedBy.length ? `<h3>被這些 paper 引用</h3><ul class="detail-list">${c.citedBy.map((id) => `<li>${nodeButton(id)}</li>`).join('')}</ul>` : ''}
        ${c.tags.length ? `<h3>概念</h3><ul class="tags">${c.tags.map((id) => `<li><button type="button" class="link-button" data-focus="${esc(id)}">${esc(id.replace(/^tag:/, ''))}</button></li>`).join('')}</ul>` : ''}`;
    } else if (raw.type === 'tag') {
      html = `
        <p class="detail-kind">共用概念</p>
        <h2>${esc(raw.label)}</h2>
        <p class="muted">${raw.papers.length} 篇 paper 都標了這個 tag。</p>
        <ul class="detail-list">${raw.papers.map((id) => `<li>${nodeButton(id)}</li>`).join('')}</ul>
        <a class="button button-quiet" href="#/?tag=${esc(raw.label)}">在文獻庫中列出</a>`;
    } else {
      html = `
        <p class="detail-kind">尚未收錄的參考文獻</p>
        <h2>${esc(raw.label)}</h2>
        <p class="muted">${raw.year ? `${esc(raw.year)} 年，` : ''}被庫內 ${raw.cited_by.length} 篇 paper 引用，是值得考慮收錄的候選。</p>
        <ul class="detail-list">${raw.cited_by.map((id) => `<li>${nodeButton(id)}</li>`).join('')}</ul>
        <a class="button button-quiet" href="${esc(referenceUrl(raw))}" target="_blank" rel="noopener">查看原文</a>`;
    }
    detail.innerHTML = `<button type="button" class="detail-close" aria-label="關閉">×</button>${html}`;
    detail.hidden = false;
    setInsets();
  }

  function focusNode(id) {
    const raw = graph.nodes.find((n) => n.id === id);
    if (!raw) return;
    // Make sure the node's layer is switched on before trying to focus it.
    if (raw.type === 'paper' && state.hiddenCategories.has(raw.category)) {
      state.hiddenCategories.delete(raw.category);
      main.querySelector(`#graph-categories [data-category="${CSS.escape(raw.category)}"]`)?.setAttribute('aria-pressed', 'true');
      refresh();
    }
    if (raw.type === 'tag' && !state.showTags) { state.showTags = true; main.querySelector('#layer-tags').checked = true; refresh(); }
    if (raw.type === 'ref' && !state.showRefs) { state.showRefs = true; main.querySelector('#layer-refs').checked = true; refresh(); }
    engine.focus(id);
  }

  detail.addEventListener('click', (ev) => {
    if (ev.target.closest('.detail-close')) { engine.select(null); return; }
    const btn = ev.target.closest('[data-focus]');
    if (btn) focusNode(btn.dataset.focus);
  });

  main.querySelector('#graph-categories').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.legend-item');
    if (!btn) return;
    const id = btn.dataset.category;
    if (state.hiddenCategories.has(id)) state.hiddenCategories.delete(id); else state.hiddenCategories.add(id);
    btn.setAttribute('aria-pressed', String(!state.hiddenCategories.has(id)));
    refresh();
  });
  main.querySelector('#layer-tags').addEventListener('change', (ev) => { state.showTags = ev.target.checked; refresh(); });
  main.querySelector('#layer-refs').addEventListener('change', (ev) => { state.showRefs = ev.target.checked; refresh(); });
  main.querySelector('#pin-on-drop').addEventListener('change', (ev) => {
    engine.pinOnDrop = ev.target.checked;
    if (!ev.target.checked) engine.releaseAll();
  });

  main.querySelector('#graph-find').addEventListener('change', (ev) => {
    const text = ev.target.value.trim().toLowerCase();
    if (!text) return;
    const hit = graph.nodes.find((n) => n.label.toLowerCase() === text) || graph.nodes.find((n) => n.label.toLowerCase().includes(text));
    if (hit) { focusNode(hit.id); ev.target.value = ''; }
  });

  main.querySelector('.graph-controls').addEventListener('click', (ev) => {
    const action = ev.target.closest('button')?.dataset.action;
    if (action === 'zoom-in') engine.zoomAt(1.35);
    if (action === 'zoom-out') engine.zoomAt(1 / 1.35);
    if (action === 'fit') engine.fit();
    if (action === 'relax') { engine.releaseAll(); setTimeout(() => engine.fit(), 700); }
  });

  // Phones start with the legend folded so the graph is visible.
  if (window.matchMedia('(max-width: 700px)').matches) main.querySelector('.graph-legend').open = false;

  refresh();
  const focus = query.get('focus');
  if (focus) focusNode(focus);

  // Exposed for automated checks.
  window.__atlasGraph = engine;

  return () => { engine.destroy(); delete window.__atlasGraph; };
}
