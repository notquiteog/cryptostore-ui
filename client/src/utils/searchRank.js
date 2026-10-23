/**
 * The one ranker behind both command palettes.
 *
 * The admin search (utils/adminSearchIndex.js) and the storefront palette
 * (utils/storeSearchIndex.js) rank written entries the same way, and they do
 * it from here rather than each carrying a copy — a second copy is the kind
 * that gets one improvement and not the other, until "why does the store
 * palette not find what the admin one finds" is a bug report.
 *
 * Every term must start a word somewhere in the haystack. Prefix-of-a-word
 * rather than substring because "age" should find "Age verification" and
 * not "Manage users"; rather than whole-word because an operator types
 * three letters and expects the list to narrow. Rank: label starts with the
 * whole query, then label contains it, then a match somewhere in the hint or
 * keywords — shorter labels first inside a rank, so "Orders" beats
 * "Orders CSV export" for the query "orders".
 */

export function startsAWord(text, term) {
  if (text.startsWith(term)) return true;
  return text.includes(` ${term}`) || text.includes(`/${term}`) || text.includes(`-${term}`);
}

/**
 * @template T
 * @param {T[]} entries
 * @param {string} query
 * @param {(entry: T) => string} haystackOf  the searchable text of one entry, label included
 * @param {(entry: T) => string} labelOf
 * @returns {T[]} ranked, best first; empty for an empty query
 */
export function rankEntries(entries, query, haystackOf, labelOf) {
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored = [];
  for (const entry of entries) {
    const label = String(labelOf(entry) || '').toLowerCase();
    const haystack = String(haystackOf(entry) || '').toLowerCase();
    if (!terms.every((t) => startsAWord(haystack, t))) continue;
    const joined = terms.join(' ');
    const rank = label.startsWith(joined) ? 0 : label.includes(joined) ? 1 : 2;
    scored.push({ entry, rank, len: label.length, label });
  }
  scored.sort((a, b) => a.rank - b.rank || a.len - b.len || a.label.localeCompare(b.label));
  return scored.map((s) => s.entry);
}
