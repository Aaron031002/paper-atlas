// A small Markdown renderer for paper introductions and advice reports.
// Supports: headings, paragraphs, bullet and numbered lists, block quotes,
// fenced code, tables, rules, **bold**, *italic*, `code`, [text](url),
// and [[paper-id]] links to papers in the library.
import { esc } from './util.js';

function inline(text, papers) {
  const codes = [];
  let out = esc(text).replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/\[\[([^\]]+)\]\]/g, (_, id) => {
    const paper = papers?.get(id.trim());
    return paper ? `<a class="paper-link" href="#/paper/${esc(paper.id)}">${esc(linkTitle(paper.title))}</a>` : esc(id);
  });
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

/** In running text: "BERT: Pre-training of…" -> "BERT"; a title without a colon is kept whole. */
function linkTitle(title) {
  const head = title.split(':')[0];
  return title.includes(':') && head.length <= 40 ? head : title;
}

/** For tight spaces such as graph labels: also truncates long titles. */
export function shortTitle(title) {
  const head = title.split(':')[0];
  return head.length <= 28 ? head : title.length <= 40 ? title : `${title.slice(0, 38)}…`;
}

export function renderInline(text, papers) {
  return inline(text, papers);
}

/**
 * @param {string} source Markdown text
 * @param {Map<string, {id: string, title: string}>} papers library papers, for [[id]] links
 * @param {number} headingBase level used for a top-level "#" heading
 */
export function renderMarkdown(source, papers, headingBase = 3) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let i = 0;

  const isBullet = (l) => /^\s*[-*]\s+/.test(l);
  const isNumbered = (l) => /^\s*\d+[.)]\s+/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    if (line.startsWith('```')) {
      const body = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) { body.push(lines[i]); i += 1; }
      i += 1;
      html.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min(6, headingBase + heading[1].length - 1);
      html.push(`<h${level}>${inline(heading[2], papers)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) { html.push('<hr>'); i += 1; continue; }

    if (line.startsWith('>')) {
      const body = [];
      while (i < lines.length && lines[i].startsWith('>')) { body.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      html.push(`<blockquote>${renderMarkdown(body.join('\n'), papers, headingBase)}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) { rows.push(cells(lines[i])); i += 1; }
      html.push(
        `<div class="table-wrap"><table><thead><tr>${head.map((c) => `<th>${inline(c, papers)}</th>`).join('')}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, papers)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
      );
      continue;
    }

    if (isBullet(line) || isNumbered(line)) {
      const ordered = isNumbered(line);
      const test = ordered ? isNumbered : isBullet;
      const items = [];
      while (i < lines.length && (test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (test(lines[i])) items.push(lines[i].replace(/^\s*(?:[-*]|\d+[.)])\s+/, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((item) => `<li>${inline(item, papers)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const para = [];
    while (
      i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !/^#{1,4}\s/.test(lines[i]) &&
      !lines[i].startsWith('>') && !isBullet(lines[i]) && !isNumbered(lines[i])
    ) { para.push(lines[i].trim()); i += 1; }
    html.push(`<p>${inline(para.join(' '), papers)}</p>`);
  }
  return html.join('\n');
}
