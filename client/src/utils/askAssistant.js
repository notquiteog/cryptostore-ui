/**
 * Open the assistant from somewhere else on the page, with a question ready.
 *
 * ── Why an event and not a context ──────────────────────────────────────────
 *
 * Two places want this — a search that matched nothing, and an order page —
 * and neither is anywhere near the buddy in the tree. The buddy lives in the
 * navbar; the callers are deep inside routed pages. Wiring a provider around
 * the whole app so two buttons can reach one component would be a lot of
 * plumbing for a one-way notification that carries a string.
 *
 * A DOM event is what a one-way notification is. No provider, no new
 * dependency, no state that can go stale, and a page that unmounts stops
 * listening by itself. If nothing is listening — the assistant is switched
 * off, or the buddy has not rendered — dispatching does nothing at all, which
 * is exactly the right behaviour for a shortcut to a feature that may not
 * exist on this store.
 *
 * The caller is responsible for not offering the button when the assistant is
 * unavailable; this is the wire, not the gate.
 */

/** The one event name, so a typo cannot silently disconnect the two halves. */
export const ASK_EVENT = 'cryptostore:ask-assistant';

/**
 * @param {string} question sent as-is; the server clamps and the buddy shows
 *   it in the transcript as though the person had typed it, which is what
 *   makes the answer make sense to them.
 */
export function askAssistant(question) {
  const text = String(question ?? '').trim();
  if (!text) return;
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { question: text } }));
}
