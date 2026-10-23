import { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import { Monitor, RefreshCw, Shield, Smartphone, Tablet, Globe, LogOut } from 'lucide-react';

/**
 * Every device holding a sign-in token for this account, and the two ways to
 * end one.
 *
 * ── What was wrong, since this is a rewrite of a panel that did not work ──
 *
 * The buttons here were reported as doing nothing, and three separate things
 * could produce that:
 *
 *   1. `window.confirm()` gated "revoke all". Every browser offers to suppress
 *      further dialogs after a page shows a few, and a suppressed confirm
 *      returns FALSE — so the handler returned early, silently, forever, with
 *      no request and nothing on screen. A destructive confirmation must not
 *      depend on a dialog the user agent is allowed to refuse to draw. It is
 *      an inline two-step now: the button becomes its own confirmation, in the
 *      row it belongs to, which is also the only version that works on a phone
 *      without a modal covering the list.
 *
 *   2. The list read and the revokes shared one rate-limit budget of sixty per
 *      fifteen minutes, and this panel re-reads the list after every change.
 *      An account with sixty-one live sessions — an ordinary number for a
 *      store's admin — ran out partway down and every later press 429'd. Fixed
 *      server side by splitting `session_revoke` out of `session_ops`; fixed
 *      here by not re-reading the whole list after a single-row revoke.
 *
 *   3. Nothing showed a request in flight. The list query used to run one
 *      revocation check per row, sequentially, so with sixty devices the reply
 *      took long enough that a press looked ignored — and an ignored press
 *      gets pressed again. Every button now goes busy the moment it is
 *      pressed, and stays disabled until the server answers.
 *
 * ── DESIGN §6, answered ───────────────────────────────────────────────────
 *
 * A RESPONSIVE TABLE (`.admin-rtable`), not two purpose-built views and not a
 * toggle. Four short fields per row, no image, no progress bar, nothing to
 * swipe: the phone wants the same record stacked, which is exactly what the
 * shared table draws below 720px. A cards/rows switch on a list that is
 * usually three rows long would be a control nobody presses.
 */

/**
 * A session timestamp, printed the one way this table needs it.
 *
 * Date AND time, not just the date: two sign-ins from the same machine on the
 * same afternoon are the case someone is scanning this list for, and a
 * day-resolution stamp makes them look like one duplicated row.
 */
const stamp = (value) => (value
  ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  : '—');

/**
 * Which of four icons a user-agent string earns.
 *
 * Not device detection and not trying to be — a user-agent is a self-reported
 * string and this is decoration that helps someone find "my phone" in a list
 * of nine. It is deliberately coarse, and the string itself stays on screen in
 * full beside it, so a wrong guess costs nothing and is visibly a guess.
 */
function deviceIcon(ua) {
  const s = String(ua || '').toLowerCase();
  if (/iphone|android.*mobile|windows phone/.test(s)) return Smartphone;
  if (/ipad|tablet|android(?!.*mobile)/.test(s)) return Tablet;
  if (/mozilla|chrome|safari|firefox|edg/.test(s)) return Monitor;
  return Globe;
}

/**
 * The shortest string that still identifies a browser and a platform.
 *
 * The full user-agent stays as the row's title attribute (DESIGN §4: hover
 * discloses), because it is the only place the exact build lives. What it
 * cannot be is the row's whole label: a modern UA is ~120 characters of
 * version numbers with the two useful words buried in the middle, and printing
 * it raw made the column unreadable and pushed the button off the end.
 */
function shortDevice(ua) {
  if (!ua) return null;
  const s = String(ua);
  const browser = /Edg\//.test(s) ? 'Edge'
    : /OPR\/|Opera/.test(s) ? 'Opera'
      : /Firefox\//.test(s) ? 'Firefox'
        : /Chrome\//.test(s) ? 'Chrome'
          : /Safari\//.test(s) ? 'Safari'
            : null;
  const platform = /Windows/.test(s) ? 'Windows'
    : /iPhone|iPad|iPod/.test(s) ? 'iOS'
      : /Mac OS X|Macintosh/.test(s) ? 'macOS'
        : /Android/.test(s) ? 'Android'
          : /Linux/.test(s) ? 'Linux'
            : null;
  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return platform;
  // Not a browser at all — a bot's `node`, a `curl`, the API. Show it whole:
  // it is short, and it is the interesting case.
  return s.length <= 40 ? s : `${s.slice(0, 40)}…`;
}

export default function SessionList() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Which row is mid-request, and which row is asking to be confirmed. Two
  // separate maps rather than one status-per-row enum, because a row can be
  // confirmed and then busy without passing through any other state, and an
  // enum invites a transition nobody drew.
  const [busy, setBusy] = useState(() => new Set());
  const [confirming, setConfirming] = useState(null); // session id, or 'all'

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await api.get('/sessions'));
      setError(null);
    } catch (e) {
      // Kept on screen rather than only toasted. A toast is gone in four
      // seconds and this panel would then be an empty table claiming the
      // account has no devices signed in, which is a dangerous thing to say
      // wrongly.
      setError(e.message || 'Could not read your devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const mark = (id, on) => setBusy((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  const revokeOne = async (id) => {
    setConfirming(null);
    mark(id, true);
    try {
      await api.delete('/sessions/' + id);
      // Drop the row rather than re-reading the list: the server just told us
      // this row is gone, and a refetch here is what made a long list burn its
      // rate-limit budget one revoke at a time.
      setSessions((prev) => prev.filter((s) => s.id !== id));
      toast.success('Device signed out');
    } catch (e) {
      toast.error(e.message || 'Could not sign that device out');
      // The server refused, so the row is still real — and it may have changed
      // for a reason worth seeing (expired, revoked elsewhere).
      load();
    } finally {
      mark(id, false);
    }
  };

  const revokeAll = async () => {
    setConfirming(null);
    mark('all', true);
    try {
      const r = await api.delete('/sessions');
      toast.success(r.message || `Revoked ${r.revoked} session(s)`);
      // Here the refetch IS right: one request ended an unknown number of
      // rows, and anything it could not end has to stay visible.
      await load();
    } catch (e) {
      toast.error(e.message || 'Could not sign the other devices out');
    } finally {
      mark('all', false);
    }
  };

  const others = sessions.filter((s) => !s.is_current);

  return (
    <section className="glass-card prof-card" id="devices">
      <div className="prof-card-head">
        <div className="prof-card-title">
          <h3><Monitor size={17} aria-hidden="true" /> Signed-in devices</h3>
          <p>
            Every device holding a sign-in token for this account. Signing one out stops it on
            its next request — a valid token is not proof of current standing.
          </p>
        </div>
        <div className="prof-card-tools">
          {/* Always here, not only when the list is long. Re-reading is how
              someone checks that a revoke they just did actually stuck. */}
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={load}
            disabled={loading}
            aria-label="Re-read the device list"
          >
            <RefreshCw size={13} aria-hidden="true" className={loading ? 'spin' : undefined} />
            <span className="prof-tool-label">Refresh</span>
          </button>
          {others.length > 0 && (
            confirming === 'all' ? (
              /* The inline two-step that replaced window.confirm(). It states
                 the count, because "all others" is a number the person cannot
                 see from the button alone. */
              <span className="prof-confirm" role="group" aria-label="Confirm signing out every other device">
                <span className="prof-confirm-q">Sign out {others.length}?</span>
                <button
                  type="button"
                  className="glass-btn glass-btn-sm glass-btn-danger"
                  onClick={revokeAll}
                  disabled={busy.has('all')}
                >
                  {busy.has('all') ? <span className="spinner spinner-inline" /> : <LogOut size={13} aria-hidden="true" />}
                  Yes, sign out
                </button>
                <button type="button" className="glass-btn glass-btn-sm" onClick={() => setConfirming(null)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="glass-btn glass-btn-sm prof-danger-text"
                onClick={() => setConfirming('all')}
                disabled={busy.has('all')}
              >
                <LogOut size={13} aria-hidden="true" />
                Sign out all others
                <span className="prof-count">{others.length}</span>
              </button>
            )
          )}
        </div>
      </div>

      {error ? (
        <div className="empty-state">
          <Monitor size={30} aria-hidden="true" />
          <h3>Could not read your devices</h3>
          <p>{error}</p>
          <div className="empty-state-links">
            <button className="glass-btn" onClick={load}>
              <RefreshCw size={14} aria-hidden="true" /> Try again
            </button>
          </div>
        </div>
      ) : loading && sessions.length === 0 ? (
        <div className="spinner" style={{ margin: '2rem auto' }} />
      ) : sessions.length === 0 ? (
        /* DESIGN §9: an empty state is navigation. "No active sessions found."
           was both a dead end and slightly alarming on a page you can only
           reach while signed in. */
        <div className="empty-state">
          <Monitor size={34} aria-hidden="true" />
          <h3>Nothing signed in but this page</h3>
          <p>
            One row appears here per device that signs in. The list empties itself whenever
            every token is revoked at once — changing your password does exactly that.
          </p>
          <div className="empty-state-links">
            <button className="glass-btn" onClick={load}>
              <RefreshCw size={14} aria-hidden="true" /> Check again
            </button>
            <a className="glass-btn" href="#two-factor">
              <Shield size={14} aria-hidden="true" /> Two-factor settings
            </a>
          </div>
        </div>
      ) : (
        <>
          <table className="admin-rtable rtable-skin prof-sessions">
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col">IP address</th>
                <th scope="col">Started</th>
                <th scope="col"><span className="sr-only">Sign out</span></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const Icon = deviceIcon(s.device_info);
                const isBusy = busy.has(s.id);
                return (
                  <tr key={s.id} className={isBusy ? 'is-busy' : undefined}>
                    <td data-label="Device">
                      <span className="prof-device">
                        <Icon size={15} aria-hidden="true" />
                        {/* The whole user-agent is the title, the readable
                            summary is the label. It used to be cut at 70
                            characters, which on a modern browser string lands
                            inside the version numbers and hides the platform —
                            the one part of it that tells you which of your
                            devices this row is. */}
                        <span className="prof-device-name" title={s.device_info || undefined}>
                          {shortDevice(s.device_info) || 'No device string sent'}
                        </span>
                        {s.is_current && <span className="badge badge-success prof-here">this device</span>}
                      </span>
                    </td>
                    {/* An empty address is the normal case, not missing data:
                        sessions record no IP unless the operator turns
                        `session_ip_logging` on (see authController), because on
                        a Tor-fronted store it is the proxy's address and on any
                        store it is retained identity. Printing "Unknown IP"
                        described the store as having failed to notice something
                        it deliberately declined to keep. */}
                    <td data-label="IP address">
                      {s.ip_address
                        ? <span className="prof-mono">{s.ip_address}</span>
                        : <span className="prof-dim">not recorded</span>}
                    </td>
                    <td data-label="Started">
                      <span className="prof-when">
                        <span className="prof-mono">{stamp(s.created_at)}</span>
                        {/* Kept visible rather than hidden behind a tooltip:
                            touch has no hover, and "when does this sign-out
                            happen on its own" is half of what the row answers. */}
                        <span className="prof-dim">expires {stamp(s.expires_at)}</span>
                      </span>
                    </td>
                    {/* Always visible, never hover-revealed. The server refuses
                        to revoke the session making the request, so the row you
                        are on says why the button is missing instead of leaving
                        a hole. */}
                    <td data-actions="">
                      {s.is_current ? (
                        <span className="prof-dim">sign out to end this one</span>
                      ) : confirming === s.id ? (
                        <span className="prof-confirm" role="group" aria-label="Confirm signing this device out">
                          <button
                            type="button"
                            className="glass-btn glass-btn-sm glass-btn-danger"
                            onClick={() => revokeOne(s.id)}
                            disabled={isBusy}
                          >
                            {isBusy ? <span className="spinner spinner-inline" /> : null}
                            Confirm
                          </button>
                          <button type="button" className="glass-btn glass-btn-sm" onClick={() => setConfirming(null)}>
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="glass-btn glass-btn-sm prof-danger-text"
                          onClick={() => setConfirming(s.id)}
                          disabled={isBusy}
                        >
                          {isBusy ? <span className="spinner spinner-inline" /> : <LogOut size={13} aria-hidden="true" />}
                          Sign out
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Said once under the table rather than repeated per row. */}
          {!sessions.some((s) => s.ip_address) && (
            <p className="prof-foot-note">
              No addresses are listed because this store does not log session IP addresses.
              Over Tor the address would be the exit node&apos;s rather than yours, and on any
              store it is one more piece of you kept for the life of the session — so the device
              string is all that is held.
            </p>
          )}
        </>
      )}
    </section>
  );
}
