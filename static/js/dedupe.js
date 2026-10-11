// Pure (no imports) so it can be unit-tested in Node.
// "once per list": same rules as the server's same_item() (case, accents, a leading The, brackets, punctuation ignored; different city / year / movie-vs-series keeps them apart)
export const normTitle = t => String(t || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[(\[][^)\]]*[)\]]/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(the|a|an) /, '');
export function sameItem(a, b) {
  const k = normTitle(a.title); if (!k || k !== normTitle(b.title)) return false;
  const ca = new Set(normTitle(a.city).split(' ').filter(Boolean)), cb = normTitle(b.city).split(' ').filter(Boolean);
  if (ca.size && cb.length && !cb.some(w => ca.has(w))) return false;
  if (a.year && b.year && String(a.year) !== String(b.year)) return false;
  return !(a.medium && b.medium && a.medium !== b.medium);
}
