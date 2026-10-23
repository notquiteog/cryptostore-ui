import { useLocation } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Sparkles, Trash2, RotateCcw, ShieldCheck, AlertTriangle,
} from 'lucide-react';
import { api } from '../../utils/api';
import { clearConversation, broadcastConversationClear } from '../../utils/aiConversation';
import { invalidateAiStatus } from '../../utils/aiStatus';
import Onboarding from '../onboarding/Onboarding';

/**
 * What this shop's AI may do with your data, and the two buttons that undo it.
 *
 * ── Why this card had to exist before the introduction could ────────────────
 *
 * The consent routes have been there since phase 2 — grant, withdraw-and-
 * erase, wipe — and until this card the only thing in the client that called
 * any of them was the assistant's own panel, which can only ever say YES. So
 * an account could switch the assistant on and had nowhere at all to switch it
 * off; the promise in docs/AI.md §5 that *withdrawing consent erases, in the
 * same request* was true of the server and unreachable from the product.
 *
 * That was survivable while the only way to consent was to press "turn it on"
 * inside the assistant. It stopped being survivable the moment an introduction
 * screen offered to enrol somebody in five capabilities at once: a switch
 * somebody can be walked into and cannot walk back out of is not consent, it
 * is a form. This card is the way back out, and it is the reason the
 * introduction is allowed to have a checkbox that starts on.
 *
 * ── It renders nothing when there is nothing to decide ──────────────────────
 *
 * Absent, not disabled, when the shop offers no buyer capability that needs
 * consent — the same rule the companion picker two cards down follows. A store
 * that made this decision for everybody should not have a switch-shaped hole
 * on its account page explaining what nobody can do.
 *
 * ── Why it reads the status directly ────────────────────────────────────────
 *
 * `getAiStatus` is a shared 60-second cache built for "should this button
 * exist". This card is where the answers are CHANGED, and showing somebody a
 * minute-old copy of their own consents on the page where they edit them is
 * how a toggle appears to bounce back. It reads fresh and invalidates the
 * shared copy after every write, so the navbar companion agrees.
 */
export default function AiConsentSection() {
  const location = useLocation();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);      // capability id currently writing
  const [confirming, setConfirming] = useState(null);
  const [wiping, setWiping] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [memories, setMemories] = useState([]);
  const [memoryError, setMemoryError] = useState('');

  const load = useCallback(async () => {
    try {
      setStatus(await api.get('/ai/status'));
      try { setMemories((await api.get('/ai/memory')).memories || []); setMemoryError(''); }
      catch { setMemoryError('Saved notes could not be loaded. You can still clear your AI data.'); }
    } catch {
      // A status that cannot be read is an assistant that is off, everywhere
      // else in this client. Same answer here: render nothing rather than a
      // card full of switches that will 409.
      setStatus(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!status || !/^#ai-[a-z]+$/.test(location.hash)) return;
    const row = document.getElementById(location.hash.slice(1));
    row?.scrollIntoView({ block: 'center' });
    row?.querySelector('input')?.focus({ preventScroll: true });
  }, [status, location.hash]);

  const offers = (status?.enabled ? status.capabilities || [] : [])
    .filter((c) => c.audience === 'buyer' && c.offered && c.needs_consent);

  /**
   * Whether to show the box for adding a note by hand.
   *
   * Gated on the person having actually turned memory ON, not merely on the
   * shop offering it: a form that saves into a capability somebody has
   * declined would be a form whose submit fails, which is a worse answer than
   * no form. The switch for it is directly above.
   */
  const memoryOffered = (status?.capabilities || [])
    .some((c) => c.id === 'memory' && c.offered && c.consented);
  const [newNote, setNewNote] = useState('');

  const write = useCallback(async (capability, on) => {
    setBusy(capability);
    try {
      if (on) await api.post(`/ai/consent/${capability}`);
      else await api.delete(`/ai/consent/${capability}`);
      invalidateAiStatus();
      await load();
      setConfirming(null);
    } catch (err) {
      toast.error(err.message || 'That could not be saved');
    }
    setBusy(null);
  }, [load]);

  const wipe = useCallback(async () => {
    setWiping(true);
    try {
      clearConversation();
      broadcastConversationClear();
      const res = await api.post('/ai/wipe', {});
      invalidateAiStatus();
      if (res.vectorsCleared === false) toast.error('Saved notes and conversations cleared. Encrypted search data could not be removed yet; please retry when the service is available.');
      else toast.success(res?.erased > 0
        ? `${res.erased} ${res.erased === 1 ? 'thing' : 'things'} erased`
        : 'Your AI data is clear');
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not erase that');
    }
    setWiping(false);
  }, [load]);

  if (!status) return null;

  // Anything still holding rows. `holds.count` is the server's own count, so
  // the confirmation can say what it is about to destroy rather than asking
  // "are you sure?" — docs/AI.md §5.
  const holding = offers.filter((c) => c.consented && c.holds && (c.holds.count ?? 0) > 0);
  const heldTotal = holding.reduce((n, c) => n + (c.holds.count || 0), 0);

  return (
    <section id="ai-data" className="glass-card prof-card aic-card">
      <div className="prof-card-head">
        <div className="prof-card-title">
          <h3><Sparkles size={17} aria-hidden="true" /> AI features and your data</h3>
          <p>
            Choose what the assistant may use. Turning a feature off also erases its saved data.
            You can clear saved notes and this browser&apos;s conversations below, even when AI is switched off.
          </p>
        </div>
      </div>

      <ul className="aic-list">
        {offers.map((c) => {
          const held = c.holds?.count ?? 0;
          const asking = confirming === c.id;
          return (
            <li key={c.id} id={`ai-${c.id}`} className={`aic-row${c.consented ? ' is-on' : ''}`}>
              <div className="aic-row-main">
                <div className="aic-row-text">
                  <span className="aic-row-title">{c.label}</span>
                  <span className="aic-row-what">{c.what}</span>
                  {/* Only when it is actually holding something. "Holding 0
                      items" is a line that says nothing, printed in the
                      brand colour, on a card whose job is to make the lines
                      that DO say something noticeable. */}
                  {c.consented && held > 0 && (
                    <span className="aic-row-holds">
                      Holding {held} {held === 1 ? 'item' : 'items'} — {c.holds.what}.
                    </span>
                  )}
                </div>
                <label className="switch aic-switch">
                  <span className="sr-only">{c.label}</span>
                  <input
                    type="checkbox"
                    checked={Boolean(c.consented)}
                    disabled={busy === c.id}
                    onChange={(e) => {
                      // Withdrawing something that holds rows asks first,
                      // inline. Not `window.confirm()`: every browser offers
                      // to suppress those, and a suppressed confirmation on a
                      // destructive control is worse than none — the same
                      // reasoning SessionList.jsx records for its own two-step.
                      if (!e.target.checked && held > 0) setConfirming(c.id);
                      else write(c.id, e.target.checked);
                    }}
                  />
                  <span className="switch-track" />
                </label>
              </div>

              {asking && (
                <div className="aic-confirm" role="group" aria-label={`Turn off ${c.label}`}>
                  <p>
                    <AlertTriangle size={13} aria-hidden="true" />
                    <span>
                      Turning this off also deletes the {held}{' '}
                      {held === 1 ? 'item' : 'items'} it holds. That cannot be undone.
                    </span>
                  </p>
                  <div className="aic-confirm-actions">
                    <button
                      type="button"
                      className="glass-btn glass-btn-sm glass-btn-danger"
                      disabled={busy === c.id}
                      onClick={() => write(c.id, false)}
                    >
                      <Trash2 size={13} aria-hidden="true" /> Turn off and erase
                    </button>
                    <button
                      type="button"
                      className="glass-btn glass-btn-sm"
                      onClick={() => setConfirming(null)}
                    >
                      Keep it on
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {memoryError && <p role="status" className="ai-hint">{memoryError}</p>}

      {/* Adding one by hand.
          The capability shipped with a consent switch, sealed vectors, an
          erase path and a footprint count — and no way to create a row except
          the raw endpoint, so it recalled from a table that was always empty.
          The assistant can add them now too, but a box is what somebody
          reaches for when they know the thing they want it to know. */}
      {memoryOffered && (
        <form
          className="ai-note-add"
          onSubmit={async (e) => {
            e.preventDefault();
            const text = newNote.trim();
            if (text.length < 3) return;
            setBusy('new');
            try {
              await api.post('/ai/memory', { content: text });
              setNewNote(''); invalidateAiStatus(); await load();
            } catch (err) { toast.error(err.message || 'Could not save that'); }
            finally { setBusy(null); }
          }}
        >
          <input
            className="glass-input"
            value={newNote}
            maxLength={300}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Something to remember — “I don’t like anything too heavy”"
            aria-label="Something for the assistant to remember"
          />
          <button type="submit" className="glass-btn glass-btn-sm" disabled={busy === 'new' || newNote.trim().length < 3}>
            Remember it
          </button>
        </form>
      )}

      {memories.length > 0 && <div className="ai-saved-notes">
        <h4>What the assistant remembers about you</h4>
        {memories.some((n) => n.source === 'inferred') && (
          /* Said plainly, because it is the difference between a note you
             wrote and one the shop worked out from what you looked at. A list
             that mixed the two without saying so would be showing somebody
             facts about themselves they never typed, unlabelled. */
          <p className="ai-hint">
            Notes marked <em>noticed</em> were not typed by you — the shop worked them out from
            what you have been asking about. Delete any of them, or switch memory off to clear the lot.
          </p>
        )}
        <ul className="aic-list">{memories.map((note) => <li className="aic-row" key={note.id}>
          <div className="aic-row-main"><p>
            {note.source === 'inferred' && <span className="ai-note-tag">noticed</span>}
            {note.content}
          </p>
            <button type="button" className="glass-btn glass-btn-sm" disabled={busy === note.id || wiping}
              aria-label={`Forget saved note ${note.id}`} onClick={async () => {
                setBusy(note.id);
                try { await api.delete(`/ai/memory/${note.id}`); invalidateAiStatus(); await load(); }
                catch (err) { toast.error(err.message || 'Could not forget this note'); }
                finally { setBusy(null); }
              }}><Trash2 size={13} /> Forget</button>
          </div>
        </li>)}</ul>
      </div>}

      <div className="aic-actions">
        {/* Erase without switching anything off. Separate from the toggles
            because somebody who wants to keep using the assistant but clear
            what it knows should not have to switch it off and on again. */}
        <button type="button" className="glass-btn glass-btn-sm" onClick={wipe} disabled={wiping}>
          <Trash2 size={13} aria-hidden="true" />
          {wiping ? 'Clearing…' : `Clear my AI data${heldTotal ? ` (${heldTotal} saved)` : ''}`}
        </button>

        {/* The introduction, again. DESIGN §9 — the page that carries these
            switches is where somebody would come looking for the explanation
            of them, so it is where the explanation is reachable from. */}
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => setReplaying(true)}>
          <RotateCcw size={13} aria-hidden="true" /> Read the introduction again
        </button>
      </div>

      <p className="aic-foot">
        <ShieldCheck size={13} aria-hidden="true" />
        <span>
          Chat stays in this browser tab until you clear it, sign out, or the shop&apos;s inactivity
          timer expires. Clearing AI data removes saved assistant notes and conversations in this
          browser. Your orders, support tickets and feature choices stay as they are.
        </span>
      </p>

      {replaying && (
        <Onboarding
          replay
          onClose={() => { setReplaying(false); load(); }}
        />
      )}
    </section>
  );
}
