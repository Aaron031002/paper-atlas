// Turns data/ into the JSON the website reads (site/data/). The site never
// reads data/ directly, so the storage format can change without touching the UI.
import fs from 'node:fs';
import path from 'node:path';
import { PATHS, loadAdvice, loadConfig, loadPapers, writeJson } from './store.mjs';
import { buildIdentityIndex, findInLibrary, identityKeys } from './identity.mjs';
import { validateLibrary } from './validate.mjs';
import { missingReferences } from './library.mjs';

// A reference the library lacks appears in the graph once this many library
// papers cite it: a hint that it may be worth adding.
const GHOST_MIN_CITED_BY = 2;
// A tag becomes a concept node once this many papers share it.
const TAG_MIN_PAPERS = 2;

export function build() {
  const config = loadConfig();
  const papers = loadPapers();
  const report = validateLibrary(papers, config);
  if (report.errors.length) return { ok: false, ...report };

  const index = buildIdentityIndex(papers);
  const byId = new Map(papers.map((p) => [p.id, p]));
  const citedBy = new Map(papers.map((p) => [p.id, []]));
  const relationsIn = new Map(papers.map((p) => [p.id, []]));
  const edges = new Map(); // "source>target" -> edge

  const full = papers.map((paper) => {
    const references = paper.references.map((ref) => {
      const hit = findInLibrary(ref, index);
      return hit && hit.paper.id !== paper.id ? { ...ref, library_id: hit.paper.id } : ref;
    });
    for (const ref of references) {
      if (!ref.library_id) continue;
      if (!citedBy.get(ref.library_id).includes(paper.id)) citedBy.get(ref.library_id).push(paper.id);
      edges.set(`${paper.id}>${ref.library_id}`, { source: paper.id, target: ref.library_id, type: 'cites' });
    }
    return { ...paper, references };
  });

  for (const paper of papers) {
    for (const rel of paper.relations || []) {
      relationsIn.get(rel.target)?.push({ source: paper.id, type: rel.type, note: rel.note });
      const key = `${paper.id}>${rel.target}`;
      const cites = edges.has(key);
      edges.set(key, { source: paper.id, target: rel.target, type: 'relation', relation: rel.type, note: rel.note, cites });
    }
  }

  // Concept nodes: tags shared by several papers.
  const tagPapers = new Map();
  for (const p of papers) for (const t of p.tags) tagPapers.set(t, [...(tagPapers.get(t) || []), p.id]);
  const nodes = papers.map((p) => ({
    id: p.id, type: 'paper', label: p.title, category: p.category, year: p.year, one_liner: p.one_liner,
  }));
  for (const [tag, ids] of tagPapers) {
    if (ids.length < TAG_MIN_PAPERS) continue;
    nodes.push({ id: `tag:${tag}`, type: 'tag', label: tag, papers: ids });
    for (const id of ids) edges.set(`${id}>tag:${tag}`, { source: id, target: `tag:${tag}`, type: 'tag' });
  }

  // Ghost nodes: frequently cited references that are not in the library yet.
  const missing = missingReferences({ minCitedBy: 1, limit: 100000 });
  for (const ref of missing.filter((r) => r.cited_by.length >= GHOST_MIN_CITED_BY)) {
    const id = `ref:${identityKeys(ref)[0]}`;
    nodes.push({ id, type: 'ref', label: ref.title, year: ref.year, arxiv: ref.arxiv, doi: ref.doi, cited_by: ref.cited_by });
    for (const pid of ref.cited_by) edges.set(`${pid}>${id}`, { source: pid, target: id, type: 'ref' });
  }

  const meta = (id) => ({ title: byId.get(id).title, category: byId.get(id).category });
  fs.rmSync(PATHS.siteData, { recursive: true, force: true });

  for (const paper of full) {
    writeJson(path.join(PATHS.siteData, 'papers', `${paper.id}.json`), {
      ...paper,
      relations: (paper.relations || []).map((r) => ({ ...r, ...meta(r.target) })),
      relations_in: relationsIn.get(paper.id).map((r) => ({ ...r, ...meta(r.source) })),
      cited_by: citedBy.get(paper.id).map((id) => ({ id, ...meta(id) })),
    });
  }

  writeJson(path.join(PATHS.siteData, 'index.json'), {
    generated_at: new Date().toISOString(),
    site: config.site,
    domain: config.domain,
    categories: config.categories,
    relation_types: config.relation_types,
    intro_sections: config.intro_sections,
    papers: full.map((p) => ({
      id: p.id, title: p.title, authors: p.authors, venue: p.venue, year: p.year, published: p.published,
      added_at: p.added_at, category: p.category, tags: p.tags, one_liner: p.one_liner,
      reference_count: p.references.length, cited_by_count: citedBy.get(p.id).length,
    })),
    graph: { nodes, edges: [...edges.values()] },
  });

  const advice = loadAdvice();
  writeJson(path.join(PATHS.siteData, 'advice.json'), advice);

  return {
    ok: true,
    papers: papers.length,
    graph_nodes: nodes.length,
    graph_edges: edges.size,
    advice_reports: advice.length,
    warnings: report.warnings,
    output: 'site/data/',
  };
}
