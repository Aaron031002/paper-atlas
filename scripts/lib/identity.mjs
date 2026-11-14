// What makes two records "the same paper". Used for de-duplication when adding,
// for matching references to papers already in the library, and by validation.

export function normalizeTitle(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function normalizeArxiv(value) {
  if (!value) return null;
  const m = /(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})(v\d+)?/i.exec(String(value));
  return m ? m[1].toLowerCase() : null;
}

export function normalizeDoi(value) {
  if (!value) return null;
  const m = /(10\.\d{4,9}\/\S+)/i.exec(String(value));
  return m ? m[1].toLowerCase().replace(/[.,;]+$/, '') : null;
}

/**
 * Identity keys for a paper or a reference entry. Two records are the same
 * paper when they share any key.
 * Accepts both shapes: a paper ({ title, ids: { arxiv, doi } }) and a reference
 * ({ title, arxiv, doi }).
 */
export function identityKeys(record) {
  const ids = record.ids || record;
  const keys = [];
  const doi = normalizeDoi(ids.doi);
  let arxiv = normalizeArxiv(ids.arxiv);
  // arXiv-issued DOIs (10.48550/arXiv.xxxx) identify the same thing as the arXiv ID.
  if (!arxiv && doi && doi.startsWith('10.48550/arxiv.')) arxiv = normalizeArxiv(doi.slice(15));
  if (arxiv) keys.push(`arxiv:${arxiv}`);
  if (doi && !doi.startsWith('10.48550/arxiv.')) keys.push(`doi:${doi}`);
  const title = normalizeTitle(record.title);
  if (title) keys.push(`title:${title}`);
  return keys;
}

/** Map from identity key to the library paper that owns it. */
export function buildIdentityIndex(papers) {
  const index = new Map();
  for (const paper of papers) {
    for (const key of identityKeys(paper)) {
      if (!index.has(key)) index.set(key, paper);
    }
  }
  return index;
}

/** The library paper matching `record`, with the key that matched, or null. */
export function findInLibrary(record, index) {
  for (const key of identityKeys(record)) {
    const hit = index.get(key);
    if (hit) return { paper: hit, matchedOn: key };
  }
  return null;
}

/** The earlier rejection matching `record`, or null. */
export function findRejected(record, rejected) {
  const keys = new Set(identityKeys(record));
  for (const entry of rejected) {
    const hit = identityKeys(entry).find((k) => keys.has(k));
    if (hit) return { entry, matchedOn: hit };
  }
  return null;
}

/** Pairs of library papers that share an identity key. Should always be empty. */
export function findDuplicatePairs(papers) {
  const seen = new Map();
  const pairs = [];
  for (const paper of papers) {
    for (const key of identityKeys(paper)) {
      const other = seen.get(key);
      if (other && other.id !== paper.id) pairs.push({ a: other.id, b: paper.id, key });
      else seen.set(key, paper);
    }
  }
  return pairs;
}
