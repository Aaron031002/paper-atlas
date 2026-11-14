// One paper's introduction. The sections come from config (index.intro_sections),
// so adding a section there makes it appear here. References are always last.
import { esc, localDate, referenceUrl } from '../util.js';
import { renderMarkdown, renderInline } from '../md.js';

const LINK_LABELS = { paper: '論文頁面', pdf: 'PDF', code: '程式碼', project: '專案頁' };

export async function renderPaper(main, ctx, { params }) {
  const id = params[0];
  if (!ctx.papers.has(id)) {
    main.className = 'page';
    main.innerHTML = `<div class="notice"><h1>文獻庫裡沒有這篇 paper</h1><p>id「${esc(id)}」不存在，可能已被移除或改名。</p><p><a href="#/">回到文獻庫</a></p></div>`;
    return;
  }
  const paper = await ctx.getPaper(id);
  const cat = ctx.category(paper.category);
  const papers = ctx.papers;

  const sections = ctx.index.intro_sections
    .filter((s) => paper.intro[s.key] && paper.intro[s.key].length)
    .map((s) => {
      const value = paper.intro[s.key];
      const body = s.type === 'bullets'
        ? `<ul>${value.map((item) => `<li>${renderInline(item, papers)}</li>`).join('')}</ul>`
        : renderMarkdown(value, papers, 3);
      return `<section class="intro-section intro-${esc(s.key)}"><h2>${esc(s.label)}</h2>${body}</section>`;
    }).join('');

  const relationItem = (other, type, note, direction) => `
    <li>
      <span class="rel-type">${direction === 'out' ? '' : '被 '}${esc(ctx.relationLabel(type))}</span>
      <a href="#/paper/${esc(other)}">${esc(papers.get(other)?.title || other)}</a>
      <p>${esc(note)}</p>
    </li>`;
  const relations = [
    ...paper.relations.map((r) => relationItem(r.target, r.type, r.note, 'out')),
    ...paper.relations_in.map((r) => relationItem(r.source, r.type, r.note, 'in')),
  ];

  const inLibrary = paper.references.filter((r) => r.library_id);
  const references = [...inLibrary, ...paper.references.filter((r) => !r.library_id)].map((ref) => {
    const meta = [ref.authors, ref.year].filter(Boolean).map(esc).join('，');
    return ref.library_id
      ? `<li class="ref in-library"><a href="#/paper/${esc(ref.library_id)}">${esc(ref.title)}</a><span class="ref-meta">${meta}</span><span class="ref-flag">已收錄</span></li>`
      : `<li class="ref"><a href="${esc(referenceUrl(ref))}" target="_blank" rel="noopener">${esc(ref.title)}</a><span class="ref-meta">${meta}</span></li>`;
  }).join('');

  main.className = 'page page-paper';
  main.innerHTML = `
    <article class="paper" style="--cat:${esc(cat.color)}">
      <p class="crumb"><a href="#/">文獻庫</a><span aria-hidden="true"> / </span><a href="#/?category=${esc(cat.id)}">${esc(cat.name)}</a></p>
      <header class="paper-head">
        <span class="chip">${esc(cat.name)}</span>
        <h1>${esc(paper.title)}</h1>
        <p class="lead">${esc(paper.one_liner)}</p>
        <p class="authors">${paper.authors.map(esc).join('、')}</p>
        <dl class="facts">
          <div><dt>發表於</dt><dd>${esc(paper.venue)}</dd></div>
          <div><dt>首次公開</dt><dd>${esc(paper.published)}</dd></div>
          <div><dt>加入文獻庫</dt><dd>${esc(localDate(paper.added_at))}</dd></div>
        </dl>
        <div class="paper-actions">
          ${Object.entries(paper.links).filter(([, url]) => url).map(([k, url]) =>
            `<a class="button" href="${esc(url)}" target="_blank" rel="noopener">${esc(LINK_LABELS[k] || k)}</a>`).join('')}
          <a class="button button-quiet" href="#/graph?focus=${esc(paper.id)}">在知識圖譜中查看</a>
        </div>
        <ul class="tags">${paper.tags.map((t) => `<li><a href="#/?tag=${esc(t)}">${esc(t)}</a></li>`).join('')}</ul>
      </header>

      ${sections}

      ${relations.length || paper.cited_by.length ? `
      <section class="intro-section paper-relations">
        <h2>與庫內其他 paper 的關係</h2>
        ${relations.length ? `<ul class="relation-list">${relations.join('')}</ul>` : ''}
        ${paper.cited_by.length ? `<p class="cited-by">庫內引用這篇的 paper：${paper.cited_by.map((c) => `<a href="#/paper/${esc(c.id)}">${esc(c.title)}</a>`).join('、')}</p>` : ''}
      </section>` : ''}

      <section class="intro-section paper-references">
        <h2>參考文獻</h2>
        <p class="ref-summary">${paper.references_complete
          ? `這篇 paper 引用的 ${paper.references.length} 篇文獻`
          : `這篇 paper 的主要參考文獻 ${paper.references.length} 篇（非完整清單）`}${inLibrary.length ? `，其中 ${inLibrary.length} 篇已收錄在文獻庫。` : '。'}</p>
        ${paper.references.length ? `<ol class="ref-list">${references}</ol>` : '<p class="muted">尚未整理參考文獻。</p>'}
      </section>
    </article>`;
}
