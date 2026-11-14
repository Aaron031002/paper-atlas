export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "2026-11-15T00:04:15Z" -> "2026-11-15" in the reader's own time zone. */
export function localDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function authorsShort(authors) {
  if (authors.length <= 3) return authors.join('、');
  return `${authors[0]} 等 ${authors.length} 人`;
}

/** Where to send the reader for a reference that is not in the library. */
export function referenceUrl(ref) {
  if (ref.url) return ref.url;
  if (ref.arxiv) return `https://arxiv.org/abs/${ref.arxiv}`;
  if (ref.doi) return `https://doi.org/${ref.doi}`;
  return `https://scholar.google.com/scholar?q=${encodeURIComponent(ref.title)}`;
}

/** Small per-browser conveniences only (last sort order). Never required to work. */
export const prefs = {
  get(key, fallback) {
    try { return localStorage.getItem(`atlas:${key}`) ?? fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(`atlas:${key}`, value); } catch { /* storage unavailable: ignore */ }
  },
};

export function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}
