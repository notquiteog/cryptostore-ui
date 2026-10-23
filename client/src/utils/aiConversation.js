// One transcript for the two navbar instances. Session storage survives page
// reloads without keeping a private conversation after the tab is closed.
const KEY = 'cs.ai.conversation.v1';
/*
 * `expired` is when the transcript threw ITSELF away, and it is a different
 * fact from "there is no transcript".
 *
 * The inactivity timeout is the strongest promise this feature makes and the
 * only one nobody can see happening: a person who walks away comes back to an
 * empty panel that looks exactly like a panel they never used. So the moment
 * of expiry is recorded — a timestamp, not a flag, so a second expiry after a
 * dismissal is still a new event — and the companion and the panel can both
 * say what happened. Cleared by hand or by signing out, it stays 0: somebody
 * who just pressed "new conversation" does not need to be told what they did.
 */
const empty = () => ({
  owner: null, turns: [], updatedAt: 0, busy: false, revision: 0, expired: 0,
});
let state = empty();
try {
  const saved = JSON.parse(sessionStorage.getItem(KEY));
  if (saved && Array.isArray(saved.turns) && Number.isFinite(saved.updatedAt)) {
    state = { ...saved, busy: false, turns: saved.turns.map((turn, i) => saved.busy && i === saved.turns.length - 1 && turn.who === 'them'
      ? { ...turn, error: 'This reply was interrupted. Please ask again.' } : turn) };
  }
} catch { /* Storage may be unavailable; the in-memory transcript still works. */ }
const listeners = new Set();
export const conversationSnapshot = () => state;
export const subscribeConversation = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function publish(next) {
  state = next;
  try {
    if (state.turns.length) sessionStorage.setItem(KEY, JSON.stringify(state));
    else sessionStorage.removeItem(KEY);
  } catch { /* Private browsing and storage quotas must not break chat. */ }
  listeners.forEach((fn) => fn());
}
export function clearConversation(owner = state.owner, reason = 'asked') {
  publish({
    ...empty(),
    owner,
    revision: (state.revision || 0) + 1,
    // Only worth reporting if there was something to lose. Expiring an empty
    // panel and announcing it would be the companion yawning at nothing.
    expired: reason === 'idle' && state.turns.length ? Date.now() : 0,
  });
}

/** The person has read the notice; stop showing it. */
export function acknowledgeExpiry() {
  if (state.expired) publish({ ...state, expired: 0 });
}
export function claimConversation(owner, idleMinutes, now = Date.now()) {
  if (state.owner !== owner) { clearConversation(owner); return; }
  if (state.updatedAt && now - state.updatedAt >= idleMinutes * 60000 && !state.busy) clearConversation(owner, 'idle');
}
export function setConversationTurns(updater) {
  publish({ ...state, turns: typeof updater === 'function' ? updater(state.turns) : updater, updatedAt: Date.now() });
}
export function setConversationBusy(busy) { publish({ ...state, busy }); }
export function conversationExpired(idleMinutes, now = Date.now()) {
  return !state.busy && state.updatedAt > 0 && now - state.updatedAt >= idleMinutes * 60000;
}

export function broadcastConversationClear() {
  try { localStorage.setItem('cs.ai.clear', String(Date.now())); } catch { /* storage can be disabled */ }
}
if (typeof window !== 'undefined') window.addEventListener('storage', (event) => { if (event.key === 'token' || event.key === 'cs.ai.clear') clearConversation(); });
