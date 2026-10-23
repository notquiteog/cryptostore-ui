import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { paletteFingerprint } from './paletteFingerprint';

/**
 * The palette's second stage: what the operator MEANT, when the words they
 * typed matched nothing.
 *
 * ── Why there is a second stage at all ──────────────────────────────────────
 *
 * `utils/searchRank.js` matches word prefixes against a label, page, hint and
 * keywords. It is a good matcher with one failure, and it is the failure every
 * keyword matcher has: it finds only what somebody thought to write down.
 * "stop people guessing passwords" starts no word in "Login attempt limits",
 * so the operator gets an empty list — and an empty list reads as "this store
 * has no such setting", which is the exact conclusion `adminSearchIndex.js`
 * says this search exists to prevent. The `keywords` field is the existing
 * answer and it does not scale, because it is a list of the synonyms one
 * person predicted.
 *
 * ── Only on zero results, and only after a pause ────────────────────────────
 *
 * Both conditions matter and neither is politeness. A hit from the word
 * matcher is a better answer than a hit by meaning, so meaning never competes
 * with it — the same ordering `catalogSearch.js` gives for the storefront, and
 * the same one `ai_search_floor`'s own hint describes ("Only affects searches
 * that matched no words at all"). And every call here is a round trip to
 * whatever machine the store embeds on, possibly over Tor: firing per
 * keystroke would be one request per character, for a list that was usually
 * already right.
 *
 * ── Degrading is the normal case, not the error case ────────────────────────
 *
 * A store with AI off, no embedding model, an unreachable model or a
 * restarting database gets `{available: false}` and this hook returns nothing
 * at all. No toast, no error row, no spinner left behind — the palette shows
 * the zero-state it showed before any of this existed. That is what makes the
 * feature safe to ship switched off, which is how every AI capability here
 * ships.
 *
 * ── The corpus goes up once per build ───────────────────────────────────────
 *
 * The server has no copy of the palette and cannot get one: the runtime image
 * carries `server/` and `client/dist`, never `client/src`. So the first search
 * after a deploy answers `need_corpus`, this hook re-sends with the entries,
 * and the server embeds and keys them by the fingerprint both sides compute.
 * After that it is one query embedding per zero-result search.
 *
 * Ids that no longer resolve to an entry are dropped rather than rendered.
 * That is what makes a stale index safe: the worst a superseded corpus can do
 * is offer fewer results, never a destination that is not there.
 */

/** One entry's searchable text — the same fields the word matcher reads. */
function entryText(e) {
  return [e.label, e.page, e.hint, e.keywords].filter(Boolean).join(' — ');
}

/** The corpus, in a stable order, as the server wants it. */
export function buildCorpus(entries) {
  return entries.map((e) => ({ id: e.id, text: entryText(e) }));
}

/**
 * Ask the server what the query is about.
 *
 * Returns entry ids, or null for "the stage could not run". The one retry is
 * the corpus handshake and nothing else: a second `need_corpus` means the
 * server could not keep what it was sent, and retrying forever would embed the
 * whole palette on a loop.
 */
async function askServer(scope, query, corpus, fingerprint) {
  const body = { scope, query, corpus: fingerprint };
  let res = await api.post('/ai/palette', body);
  if (res?.need_corpus) {
    res = await api.post('/ai/palette', { ...body, entries: corpus });
  }
  if (!res?.available || !Array.isArray(res.ids)) return null;
  return res.ids;
}

/**
 * @param {object[]} entries   the palette's own entries, already permission-filtered
 * @param {string} query       what is typed
 * @param {boolean} enabled    false when the word matcher already found something
 * @param {'admin'|'store'} scope
 * @returns {object[]} entries ranked by meaning, or [] — never a loading state
 */
export function useMeaningResults(entries, query, enabled, scope) {
  const [ids, setIds] = useState([]);
  // The corpus and its fingerprint change only when the palette does, which in
  // practice is once per page load. Recomputing them per keystroke would hash
  // a few hundred strings on every character typed.
  const corpusRef = useRef(null);
  if (!corpusRef.current || corpusRef.current.source !== entries) {
    const corpus = buildCorpus(entries);
    corpusRef.current = { source: entries, corpus, fingerprint: paletteFingerprint(corpus) };
  }

  // Queries already answered, so backspacing through a word does not re-ask
  // for something this tab has already been told. Per mount: a page load is a
  // fine boundary for a cache of navigation results.
  const seen = useRef(new Map());
  // Guards a late response from overwriting a newer one — the classic
  // out-of-order race, which on a type-ahead shows results for a query the
  // operator has already finished editing.
  const latest = useRef(0);

  const term = query.trim();

  useEffect(() => {
    if (!enabled || term.length < 3) { setIds([]); return undefined; }

    const cached = seen.current.get(term);
    if (cached) { setIds(cached); return undefined; }

    const ticket = latest.current + 1;
    latest.current = ticket;
    let cancelled = false;

    // Long enough that finishing a word does not cost a request, short enough
    // that it feels like part of the same keystroke rather than a second
    // search the operator has to wait for.
    const timer = setTimeout(async () => {
      const { corpus, fingerprint } = corpusRef.current;
      let found = null;
      try {
        found = await askServer(scope, term, corpus, fingerprint);
      } catch {
        found = null;
      }
      if (cancelled || latest.current !== ticket) return;
      const list = found || [];
      seen.current.set(term, list);
      setIds(list);
    }, 320);

    return () => { cancelled = true; clearTimeout(timer); };
  }, [term, enabled, scope]);

  if (!enabled || ids.length === 0) return [];
  // Resolve against the entries this viewer can reach. An id the server knows
  // and this account cannot open simply does not appear — the palette's rule
  // that an unreachable entry is ABSENT rather than greyed, which is also what
  // stops Enter ever landing on a 403.
  const byId = new Map(entries.map((e) => [e.id, e]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}
