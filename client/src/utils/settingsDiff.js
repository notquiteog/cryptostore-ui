/**
 * What actually changed on a settings form.
 *
 * ── The bug this exists to prevent ──────────────────────────────────────────
 *
 * `PUT /api/settings` takes an object of key → value and writes every key in
 * it. Several admin pages built that object out of their whole form state, so
 * pressing Save sent every setting the page holds — not the ones that had been
 * touched. On the main settings page that is roughly two hundred keys.
 *
 * With one operator that is invisible: writing a value back over itself is a
 * no-op. With two it is a lost update, and a quiet one. Admin A opens Settings;
 * admin B changes the Tor port and saves; admin A ticks one unrelated switch
 * and saves — and A's page, which loaded before B's change, sends its stale Tor
 * port along with everything else and puts it back. Neither of them is told.
 * Nothing errors. The audit log records A changing a setting they never looked
 * at, which is the only trace, and it looks like A did it on purpose.
 *
 * Two pages already got this right and their comments say why. `Limits.jsx`
 * builds its payload from `dirtyKeys`, and `AiSettings.jsx` sends its `edits`
 * map with the note that "a manager scoped to settings.security must not be
 * 403'd by an unrelated key riding along — the controller rejects the whole PUT
 * if any single key is out of scope". That second reason matters as much as the
 * first: a whole-object PUT makes every save require every permission the page
 * can reach, so a narrowly-scoped manager could not save at all.
 *
 * This is that rule in one place, so the next page to grow a Save button
 * inherits it instead of re-deriving it.
 *
 * ── What it does NOT solve, stated plainly ──────────────────────────────────
 *
 * Two people editing the SAME setting. Whoever saves second still wins, because
 * nothing here carries a version. What this removes is the far more common and
 * far more surprising case — two people editing DIFFERENT settings and one of
 * them silently reverting the other. Fixing the same-key case needs a
 * compare-and-set on the wire, which is a server contract change and a
 * different piece of work.
 */

/**
 * Compare as the wire will carry it.
 *
 * Every settings value is stored and sent as text, but a form holds booleans
 * for switches and numbers for numeric fields — so `true` and `'true'` are the
 * same setting and must not read as a change. Comparing the string forms is
 * what the server does when it writes, so it is what "changed" has to mean
 * here or a page would send a key on every save forever.
 *
 * `null` and `undefined` both collapse to the empty string, which is how a
 * cleared field and an absent one are already stored.
 */
function wireValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v);
}

/**
 * The keys whose value differs from the baseline, as an object ready to PUT.
 *
 * @param {object} next      the form's current values
 * @param {object} baseline  what the server last told us it holds
 * @param {{only?: string[]}} [opts]  restrict to these keys — for a page whose
 *   form carries fields that are not settings at all
 * @returns {object} only the changed keys
 */
export function changedSettings(next, baseline, { only } = {}) {
  const out = {};
  if (!next || typeof next !== 'object') return out;
  const base = baseline && typeof baseline === 'object' ? baseline : {};
  const keys = only || Object.keys(next);
  for (const key of keys) {
    if (!(key in next)) continue;
    // A key the baseline has never seen is a change by definition: it is either
    // new, or the page is saving before it has a baseline, and sending it is
    // the safe direction. The alternative — treating "no baseline" as "no
    // change" — is a Save button that does nothing.
    if (wireValue(next[key]) !== wireValue(base[key])) out[key] = next[key];
  }
  return out;
}

/** Whether anything at all would be sent. For a Save button's disabled state. */
export function hasChanges(next, baseline, opts) {
  return Object.keys(changedSettings(next, baseline, opts)).length > 0;
}

/**
 * The changed keys, each carrying what the form was showing before it.
 *
 * This is the payload for the OTHER half of the problem. Sending only the
 * changed keys stops two people editing different settings from reverting each
 * other; it leaves two people editing the SAME setting to last-write-wins, and
 * `__base` is what lets the server refuse that instead.
 *
 * The server compares each baseline against what is stored and answers 409 with
 * the keys that moved, naming nothing about a secret beyond the fact that it
 * changed. Optional on the wire, so a caller that has no baseline — a script, a
 * bot, an import — behaves exactly as it always did.
 *
 * `__base` rather than a second argument to `api.put` because the settings
 * endpoint takes one object and every other writer of it is already shaped that
 * way; a parallel parameter would be a second calling convention for one page.
 *
 * @returns {object|null} the payload, or null when nothing changed
 */
export function changedWithBase(next, baseline, opts) {
  const changes = changedSettings(next, baseline, opts);
  const keys = Object.keys(changes);
  if (!keys.length) return null;
  const base = {};
  for (const key of keys) base[key] = wireValue(baseline?.[key]);
  return { ...changes, __base: base };
}

export { wireValue };
