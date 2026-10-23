import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CloudOff, Hourglass, RefreshCw, ServerCrash, WifiOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { formatWait } from '../utils/sessionRetry';

/**
 * What a guarded page shows while the browser holds a session the store has
 * not been able to confirm.
 *
 * ── Why this and not the sign-in form ───────────────────────────────────────
 *
 * A rate-limit reply, a dropped Tor circuit or a store restarting used to send
 * a signed-in person to /login: `AuthContext` kept the token but left `user`
 * null, and every guard reads "no user" as "signed out". Nothing was wrong
 * with their session — the same token read 200 a minute later — so the sign-in
 * form was the wrong place to put them, and on a store reached over Tor it is
 * an expensive one. This takes the page's place instead, and the page itself
 * appears the moment a check succeeds; nobody is navigated anywhere.
 *
 * ── What it says ────────────────────────────────────────────────────────────
 *
 * Why, in words about THIS failure rather than a generic "something went
 * wrong"; that the sign-in is kept, because the fear on this screen is having
 * been logged out; when the next attempt is; and two ways forward (DESIGN §9):
 * try now, or sign in as somebody else for the person who is at a shared
 * machine and wanted to anyway.
 *
 * "Try now" is disabled while a wait the STORE asked for is running. Pressing
 * early against a rate limiter is not faster — it is another 429, counted
 * against the same window — so the button says when it will be worth pressing
 * instead of letting somebody spend the wait making it longer.
 */

const REASONS = {
  rate: { Icon: Hourglass, line: 'The store asked this browser to slow down for a moment.' },
  network: { Icon: WifiOff, line: 'The connection dropped before the store answered.' },
  offline: { Icon: CloudOff, line: 'This device is offline.' },
  server: { Icon: ServerCrash, line: 'The store did not answer — it may be restarting.' },
};

export default function SessionRetry() {
  const { unconfirmed, retrySession, logout } = useAuth();
  const navigate = useNavigate();
  const [now, setNow] = useState(() => Date.now());

  // The countdown ticks once a second while the card is up. A render, never a
  // request: the checks themselves are scheduled by AuthContext.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (!unconfirmed) return null;
  const {
    reason, retryAt, checking, serverWait,
  } = unconfirmed;
  const { Icon, line } = REASONS[reason] || REASONS.network;
  const left = Math.max(0, retryAt - now);
  const held = serverWait && left > 0;

  // The same order the navbar signs out in: the request goes out while the
  // token is still attached (so the server can revoke it), and the page moves
  // without waiting for it — on a dead connection that request may take a
  // Tor circuit's whole timeout to fail.
  const switchAccount = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <section className="session-retry" aria-labelledby="session-retry-title">
      <div className="session-retry-panel glass-card">
        <span className="session-retry-mark" data-reason={reason} aria-hidden="true">
          <Icon size={22} />
        </span>
        <h1 id="session-retry-title" className="session-retry-title">
          Can&apos;t reach the store right now
        </h1>
        {/* The live region is the reason alone: the countdown below changes
            every second, and a screen reader announcing each tick would make
            the page unusable to exactly the person waiting on it. */}
        <p className="session-retry-why" role="status">{line}</p>
        <p className="session-retry-kept">
          You&apos;re still signed in and nothing has been lost. This page opens
          by itself as soon as the store answers.
        </p>
        <p className="session-retry-next" aria-hidden="true">
          {checking ? (
            <>
              <RefreshCw size={14} className="session-retry-spin" />
              Asking the store…
            </>
          ) : (
            <>Trying again in <b>{formatWait(left)}</b></>
          )}
        </p>
        <div className="session-retry-actions">
          <button
            type="button"
            className="glass-btn glass-btn-primary"
            onClick={retrySession}
            disabled={checking || held}
            title={held ? 'The store asked this browser to wait; pressing sooner would only be refused again' : undefined}
          >
            <RefreshCw size={15} aria-hidden="true" />
            {held ? `Try now in ${formatWait(left)}` : 'Try now'}
          </button>
          <button type="button" className="glass-btn" onClick={switchAccount}>
            Sign in as someone else
          </button>
        </div>
      </div>
    </section>
  );
}
