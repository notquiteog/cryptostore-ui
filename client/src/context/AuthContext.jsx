import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react';
import { clearConversation } from '../utils/aiConversation';
import { invalidateAiStatus } from '../utils/aiStatus';
import { api } from '../utils/api';
import { clearRefTag } from '../utils/refTag';
import { forgetStoreDecryptKey } from '../hooks/useStoreDecryptKey';
import { classifyFailure, nextRetryDelay } from '../utils/sessionRetry';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  /**
   * A session this browser holds but could not confirm: `{ reason, retryAt,
   * attempt, checking, serverWait }`, or null.
   *
   * ── Why there is a third state ──────────────────────────────────────────────
   *
   * The check below already refused to clear the token on a transient failure
   * (its comment says why). But it left `user` null and `loading` false, and
   * every route guard in App.jsx reads exactly those two — no user, not
   * loading, so to /login. The token survived and the person was bounced anyway,
   * which was the whole failure the comment said was fixed. Seen on the dev
   * store: `/auth/me` answered 429 after a burst of reloads, the admin panel
   * landed on the sign-in form with the token still in storage, and the same
   * token read 200 a minute later.
   *
   * So a guard now has three answers, not two: signed in, signed out, and "not
   * confirmed yet" — which renders `components/SessionRetry.jsx` where the page
   * would be, and keeps asking until the store answers. When it does, the page
   * the person asked for simply appears; nobody was navigated anywhere. That
   * matters most on a Tor-fronted store, where a dropped circuit is ordinary
   * and a sign-in form is the most expensive place to be sent by one.
   *
   * `retryAt` and `serverWait` are mirrored into refs because the event
   * handlers and the manual retry read them between renders.
   */
  const [unconfirmed, setUnconfirmed] = useState(null);
  const attempts = useRef(0);
  const timer = useRef(null);
  const inFlight = useRef(false);
  const retryAt = useRef(0);
  const serverWait = useRef(false);

  const checkSession = useCallback(async () => {
    // One question at a time. StrictMode mounts twice in development, and a
    // manual retry can land while the timed one is out.
    if (inFlight.current) return;
    clearTimeout(timer.current);
    if (!localStorage.getItem('token')) {
      setUnconfirmed(null);
      setLoading(false);
      return;
    }
    inFlight.current = true;
    setUnconfirmed((u) => (u ? { ...u, checking: true } : u));
    try {
      const data = await api.get('/auth/me');
      attempts.current = 0;
      setUser(data);
      setUnconfirmed(null);
    } catch (err) {
      // Deliberately does NOT clear the token.
      //
      // Any failure used to log the visitor out, so a rate-limit reply, a
      // dropped connection or a server restart signed them out of a session
      // that was still perfectly valid — and on a page behind RequireAuth
      // that means being bounced to the login screen mid-task.
      //
      // A session that has genuinely ended returns 401, and `api.js`
      // already clears the token and redirects on exactly that. Everything
      // else is transient and the token should survive it: the next
      // request will either succeed or produce the 401 that ends it.
      //
      // Keeping the token was only half of it — see `unconfirmed` above. A
      // transient failure now schedules the next check; an answer about the
      // account (401, a 403 "deactivated") leaves the old signed-out state.
      const reason = classifyFailure(err);
      if (!reason) {
        setUnconfirmed(null);
      } else {
        const wait = nextRetryDelay(attempts.current, err?.retryAfterMs);
        attempts.current += 1;
        retryAt.current = Date.now() + wait;
        serverWait.current = err?.retryAfterMs != null;
        setUnconfirmed({
          reason,
          retryAt: retryAt.current,
          attempt: attempts.current,
          checking: false,
          serverWait: serverWait.current,
        });
        // A hidden tab does not spend a request on a store nobody is looking
        // at. It leaves the check due, and the return to the tab (below) asks.
        timer.current = setTimeout(() => {
          if (document.visibilityState !== 'hidden') checkSession();
        }, wait);
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();
    return () => clearTimeout(timer.current);
  }, [checkSession]);

  // While a check is waiting, two events can end the wait — and only when the
  // wait is theirs to end.
  //
  // Coming back to the tab asks only if the check is already DUE. A browser can
  // report a return every second (the embedded preview pane flips a hidden tab
  // to visible about once a second; Chrome's occlusion tracking does it to a
  // covered window), and a handler that asked on every return would undo the
  // whole backoff. `retryAt` moves forward after each failure, so returns can
  // never ask more often than the schedule does.
  //
  // `online` asks at once, because a wait for the network is over when the
  // network is back — unless the store itself set the wait, in which case the
  // connection coming back changes nothing about when its window reopens.
  useEffect(() => {
    if (!unconfirmed) return undefined;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= retryAt.current) checkSession();
    };
    const onOnline = () => { if (!serverWait.current) checkSession(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [unconfirmed, checkSession]);

  /**
   * "Try now", from the retry card. Honours a wait the store asked for even
   * here: pressing early against a rate limiter is not faster, it is another
   * 429 counted against the same window.
   */
  const retrySession = useCallback(() => {
    if (serverWait.current && Date.now() < retryAt.current) return;
    checkSession();
  }, [checkSession]);

  // Any path that settles the question — signing in, signing up, signing out —
  // also stops the retries, or a timer set for a session that no longer exists
  // would fire into the one that replaced it.
  const settle = () => {
    clearTimeout(timer.current);
    attempts.current = 0;
    serverWait.current = false;
    setUnconfirmed(null);
  };

  /**
   * Sign in.
   *
   * Three shapes reach this one endpoint:
   *
   *   password only              ordinary sign-in
   *   password + challenge answer  PGP 2FA, second leg
   *   challenge answer only        key-only account, second leg
   *
   * The last is why `password` is optional here: an account with
   * `pgp_login_only` has no password step at all, and sending an empty string
   * would be indistinguishable from a wrong one.
   *
   * A response carrying `pgp_challenge` is not a session — it is the server
   * asking the caller to prove they hold the key — so it is handed back to the
   * page untouched rather than being mistaken for a successful login.
   */
  const login = async (username, password, pgpChallenge) => {
    const body = { username };
    if (password) body.password = password;
    if (pgpChallenge) body.pgp_challenge_response = pgpChallenge;

    const data = await api.post('/auth/login', body);

    if (data.requires_2fa || data.requires_pgp || !data.token) {
      return data;
    }

    localStorage.setItem('token', data.token);
    settle();
    setUser(data.user);
    return data;
  };

  /**
   * Ask for a login challenge for a key-only account.
   *
   * Always answers with a challenge, whether or not the username exists — the
   * server encrypts to a decoy key otherwise — so this cannot be used to find
   * out which accounts are real. The page therefore cannot (and must not try
   * to) tell the caller whether the name was right.
   */
  const requestPgpChallenge = async (username) => api.post('/auth/pgp-challenge', { username });

  /**
   * Create an account.
   *
   * `inviteCode` used to be accepted by the signup form, passed to this
   * function as a fourth argument, and then silently dropped: the parameter
   * list stopped at `pgpKey` and the body never carried `invite_code`. The
   * server has always read it, so on an invite-only store every registration
   * was answered with "Registration requires an invite link" no matter what
   * the visitor pasted into the box, and on an open store every invite link
   * in existence attached no referrer and created no sub-user. The link
   * worked; the form on the other end of it did not.
   *
   * It is one field carrying two spellings — a code the operator generated or
   * a tag somebody chose — and the server resolves either
   * (`server/utils/refLinks.js`), so the caller does not have to know which
   * kind it is holding.
   */
  const register = async (username, password, pgpKey, inviteCode) => {
    const data = await api.post('/auth/register', {
      username,
      password,
      pgp_public_key: pgpKey || undefined,
      invite_code: inviteCode || undefined,
    });
    localStorage.setItem('token', data.token);
    settle();
    setUser(data.user);
    // The attribution now lives on `users.invited_by_link_id`, server-side and
    // permanent, so the copy in this browser has done its job. Left behind, it
    // would attribute the NEXT person who signs up on this machine — a shared
    // computer, a family tablet — to the same referrer, which is a mistake
    // that pays somebody money.
    clearRefTag();
    return data;
  };

  const logout = async () => {
    settle();
    try { await api.post('/auth/logout'); } catch { /* best-effort */ }
    clearConversation();
    invalidateAiStatus();
    // The store private key, if this session had been handed one for browser
    // decryption. Dropped with the token rather than left in a module variable
    // for whoever signs in next on a shared bench machine — see
    // hooks/useStoreDecryptKey.js. It is only ever in memory, so signing out is
    // the whole of the cleanup, but it has to actually happen: the cache
    // outlives the component tree by design.
    forgetStoreDecryptKey();
    localStorage.removeItem('token');
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const data = await api.get('/auth/me');
      setUser(data);
    } catch {
      // Same reasoning as the mount check: a failed refresh is not proof the
      // session ended, and `api.js` already handles the 401 that would be.
      // Logging out here turned every blip into a forced sign-out.
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user, loading, unconfirmed, retrySession,
        login, requestPgpChallenge, register, logout, refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
