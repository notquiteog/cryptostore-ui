import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * What to do when a save was refused because somebody else got there first.
 *
 * ── Why a chooser rather than a reload ──────────────────────────────────────
 *
 * The first version of this reloaded the page and said what had moved, which is
 * correct and throws away the operator's work. They had typed something for a
 * reason, and the reason has not stopped being true because a colleague touched
 * the same switch — they simply now need to know what the colleague chose
 * before deciding whether they still mean it.
 *
 * So both values are on screen and the choice is one press per key. The theme
 * editor makes the same argument for a whole palette; this is it at the
 * granularity a settings form has, where the keys are independent and the
 * conflict is usually one.
 *
 * ── Why "theirs" is the primary ─────────────────────────────────────────────
 *
 * Because it is already true. Taking theirs is agreeing with the database and
 * needs no write at all — the form just stops disagreeing with it. Keeping
 * yours is a decision to overwrite a colleague's edit, made with their value in
 * front of you, which is exactly the decision this whole mechanism exists to
 * put in front of somebody rather than let happen silently.
 *
 * ── Secrets ─────────────────────────────────────────────────────────────────
 *
 * The server sends `{ key, secret: true }` and no values for those, because a
 * conflict report printing somebody's new bot token would be a permission hole
 * with a helpful face on it. There is nothing to choose between, so the row
 * says what happened and offers only "reload".
 */
export default function SettingsConflict({ conflicts, onKeepMine, onTakeTheirs, onReload, onDismiss }) {
  if (!conflicts?.length) return null;
  const someSecret = conflicts.some((c) => c.secret);

  return (
    <section className="glass-card admin-panel-in scfl" role="alert" aria-labelledby="scfl-h">
      <h3 id="scfl-h" className="admin-card-title scfl-title">
        <AlertTriangle size={15} aria-hidden="true" />
        {conflicts.length === 1
          ? 'Somebody else changed this setting while you were editing'
          : `Somebody else changed ${conflicts.length} of these settings while you were editing`}
      </h3>
      <p className="admin-hint">
        Nothing was saved. Their values are already in force — pick which to keep, then save again.
      </p>

      <ul className="scfl-list">
        {conflicts.map((c) => (
          <li key={c.key} className="scfl-row">
            <code className="scfl-key">{c.key}</code>
            {c.secret ? (
              <span className="scfl-secret">changed — the value is not shown</span>
            ) : (
              <>
                <span className="scfl-side">
                  <span className="scfl-label">theirs</span>
                  <span className="scfl-value">{c.theirs === '' ? <em>empty</em> : c.theirs}</span>
                </span>
                <span className="scfl-side">
                  <span className="scfl-label">yours</span>
                  <span className="scfl-value">{c.yours === '' ? <em>empty</em> : c.yours}</span>
                </span>
                <span className="scfl-acts">
                  {/* Theirs first and primary: it is already true, so taking it
                      is agreeing with the database rather than writing to it. */}
                  <button type="button" className="glass-btn glass-btn-primary glass-btn-sm" onClick={() => onTakeTheirs(c)}>
                    Take theirs
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => onKeepMine(c)}>
                    Keep mine
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="scfl-foot">
        {/* Always available, and the only option on a secret. Somebody who does
            not want to reason about it should be able to take the whole page
            back to what is stored in one press. */}
        <button type="button" className={`glass-btn glass-btn-sm${someSecret ? ' glass-btn-primary' : ''}`} onClick={onReload}>
          <RefreshCw size={13} aria-hidden="true" /> Reload everything
        </button>
        <button type="button" className="glass-btn glass-btn-sm" onClick={onDismiss}>Dismiss</button>
      </div>
    </section>
  );
}
