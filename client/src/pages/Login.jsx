import { useEffect, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import BrandMark from '../components/BrandMark';
import MirrorCheck from '../components/MirrorCheck';
import toast from 'react-hot-toast';
import { Check, Copy, KeyRound, LockKeyhole, LogIn, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';

/**
 * Sign in, by password or by key.
 *
 * Two methods share one form because they share a username and most of a
 * layout, and because the *account* decides which applies — a key-only account
 * has no password, and typing one would be answered with the same flat 401 as a
 * wrong one. The picker lets the person say which they hold before the server
 * has to guess.
 *
 * Both methods converge on the same challenge step: an armored block the
 * account holder decrypts in their own PGP client, pasting back the token
 * inside. Password + challenge is 2FA; challenge alone is passwordless login.
 * The panel below is the same in both cases, so there is one thing to learn.
 *
 * A third step can follow either of them: an account whose second factor is an
 * authenticator app is asked for a six-digit code once — and only once — the
 * first factor has been proved. There is no picker for it, because the account
 * decides, and offering the choice up front would tell an anonymous visitor
 * which usernames have which factor.
 */

const METHODS = [
  { key: 'password', label: 'Password', icon: LockKeyhole },
  { key: 'pgp', label: 'PGP key', icon: KeyRound },
];

/** mm:ss remaining on the challenge, or null once it has run out. */
function useExpiry(seconds, resetKey) {
  const [left, setLeft] = useState(seconds || 0);

  useEffect(() => {
    setLeft(seconds || 0);
    if (!seconds) return undefined;
    const id = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(id);
  }, [seconds, resetKey]);

  if (!seconds) return null;
  if (left <= 0) return 'expired';
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function Login() {
  const { login, requestPgpChallenge, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [method, setMethod] = useState('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const [challenge, setChallenge] = useState('');
  const [challengeAt, setChallengeAt] = useState(0);
  const [expiresIn, setExpiresIn] = useState(0);
  const [answer, setAnswer] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);

  // Set only after the server has said this account wants an authenticator
  // code. It is never inferred from anything the visitor typed.
  const [totpWanted, setTotpWanted] = useState(false);
  const [totpCode, setTotpCode] = useState('');

  const answerRef = useRef(null);
  const totpRef = useRef(null);
  const remaining = useExpiry(expiresIn, challengeAt);

  // The challenge belongs to one username. Changing it mid-flow would leave a
  // block on screen that can never be answered, so the step resets with it.
  const resetChallenge = () => {
    setChallenge('');
    setAnswer('');
    setExpiresIn(0);
    setCopied(false);
    setTotpWanted(false);
    setTotpCode('');
  };

  useEffect(() => {
    if (challenge && answerRef.current) answerRef.current.focus();
  }, [challenge]);

  useEffect(() => {
    if (totpWanted && totpRef.current) totpRef.current.focus();
  }, [totpWanted]);

  const copyChallenge = async () => {
    try {
      await navigator.clipboard.writeText(challenge);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy — select the block and copy it manually');
    }
  };

  /** Ask for a fresh block. Used by the PGP method and by "new challenge". */
  const askForChallenge = async () => {
    if (!username.trim()) return toast.error('Enter your username first');
    setLoading(true);
    try {
      const data = await requestPgpChallenge(username.trim());
      setChallenge(data.pgp_challenge);
      setChallengeAt(Date.now());
      setExpiresIn(data.expires_in || 300);
      setAnswer('');
      // Deliberately not "account found" — the server answers every username
      // identically so this page cannot be used to discover which ones exist.
      toast('Decrypt the block with your PGP key and paste the token below');
    } catch (err) {
      toast.error(err.message || 'Could not start a PGP sign-in');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // PGP method, no block yet: this submit is the request for one.
    if (method === 'pgp' && !challenge) return askForChallenge();

    setLoading(true);
    try {
      let data;

      if (totpWanted) {
        // Posted here rather than through AuthContext's `login()`.
        //
        // That helper's third parameter is named `pgpChallenge` and is put on
        // the wire as `pgp_challenge_response`. A TOTP code is not a challenge
        // answer, and squeezing it through that argument would make the
        // function's own name a lie for the next person reading it — the exact
        // thing CLAUDE.md calls out about `pgp_signed_challenge`. Until
        // AuthContext grows a `totp_code` parameter of its own, this leg
        // stores the token and re-reads the account the same way `login()`
        // does, so the outcome is identical.
        data = await api.post('/auth/login', {
          username: username.trim(),
          ...(method === 'password' ? { password } : {}),
          ...(challenge ? { pgp_challenge_response: answer.trim() } : {}),
          totp_code: totpCode.trim(),
        });
        if (data?.token) {
          localStorage.setItem('token', data.token);
          await refreshUser();
        }
      } else {
        data = await login(
          username.trim(),
          method === 'password' ? password : undefined,
          challenge ? answer.trim() : undefined,
        );
      }

      // The server wants proof of the key before it issues a session. Same
      // panel for 2FA and for passwordless — see the file header.
      if (data?.pgp_challenge) {
        setChallenge(data.pgp_challenge);
        setChallengeAt(Date.now());
        setExpiresIn(data.expires_in || 300);
        toast('Decrypt the PGP challenge and paste the token below');
        setLoading(false);
        return;
      }

      // First factor accepted; this account also wants a code. The password (or
      // the answered challenge) stays in state because the next request carries
      // all of it — the server proves every factor again on the leg that
      // actually issues the session.
      if (data?.requires_totp) {
        setTotpWanted(true);
        setTotpCode('');
        toast('Enter the code from your authenticator app');
        setLoading(false);
        return;
      }

      toast.success('Welcome back!');
      navigate('/');
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  const canSubmit = totpWanted
    ? totpCode.trim().length > 0
    : challenge ? answer.trim().length > 0 : true;

  return (
    <div className="page auth-page">
      <div aria-hidden="true" className="auth-glow" />
      <div className="glass-card auth-card">
        {/* The mark, not a caption: whoever is asking for credentials should
            be identifiable at a glance. A heading survives for screen readers. */}
        <BrandMark />
        <h2 className="sr-only">Sign in</h2>

        <div className="segmented auth-method" role="tablist" aria-label="Sign-in method">
          {METHODS.map((m) => {
            const Icon = m.icon;
            const active = method === m.key;
            return (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={active}
                className={`segmented-option${active ? ' active' : ''}`}
                onClick={() => {
                  if (active) return;
                  setMethod(m.key);
                  resetChallenge();
                  setPassword('');
                }}
              >
                <Icon size={13} aria-hidden="true" /> {m.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              type="text"
              className="glass-input"
              value={username}
              onChange={(e) => { setUsername(e.target.value); if (challenge) resetChallenge(); }}
              placeholder="Enter your username"
              required
              autoComplete="username"
            />
          </div>

          {method === 'password' && !challenge && !totpWanted && (
            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                className="glass-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
            </div>
          )}

          {method === 'pgp' && !challenge && !totpWanted && (
            <p className="auth-note">
              <ShieldCheck size={13} aria-hidden="true" />
              <span>
                No password is sent. The store encrypts a one-time token to your public key;
                decrypting it is what proves the account is yours.
              </span>
            </p>
          )}

          {/* The challenge panel folds away once its answer has been accepted
              and a code is what is wanted. `answer` stays in state and still
              travels on the next request — the server re-checks every factor
              on the leg that issues the session. */}
          {challenge && !totpWanted && (
            <div className="auth-challenge" data-reveal>
              <div className="auth-challenge-head">
                <span className="auth-challenge-title">
                  <KeyRound size={13} aria-hidden="true" /> Encrypted challenge
                </span>
                <span className="auth-challenge-meta">
                  {remaining === 'expired'
                    ? <span className="auth-challenge-expired">Expired — request a new one</span>
                    : <>Valid for <b>{remaining}</b></>}
                </span>
              </div>

              <textarea
                className="glass-input auth-challenge-block"
                value={challenge}
                readOnly
                rows={7}
                aria-label="PGP encrypted challenge block"
                onFocus={(e) => e.target.select()}
              />

              <div className="auth-challenge-actions">
                <button type="button" className="glass-btn glass-btn-sm" onClick={copyChallenge}>
                  {copied
                    ? <><Check size={13} aria-hidden="true" /> Copied</>
                    : <><Copy size={13} aria-hidden="true" /> Copy block</>}
                </button>
                {/* In the 2FA flow a new challenge means proving the password
                    again, which this panel has deliberately cleared. Sending the
                    person back to the password step is the only honest option —
                    the button used to render disabled with a tooltip telling
                    them to do something the form gave them no way to do. */}
                <button
                  type="button"
                  className="glass-btn glass-btn-sm"
                  onClick={method === 'pgp' ? askForChallenge : () => { resetChallenge(); setPassword(''); }}
                  disabled={loading}
                  title={method === 'pgp'
                    ? 'Discard this block and start again'
                    : 'Start again from your password'}
                >
                  <RefreshCw size={13} aria-hidden="true" />
                  {method === 'pgp' ? 'New challenge' : 'Start over'}
                </button>
              </div>

              <div className="form-group auth-challenge-answer">
                <label htmlFor="login-token">Decrypted token</label>
                <input
                  id="login-token"
                  ref={answerRef}
                  type="text"
                  className="glass-input"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder="Paste the token from inside the block"
                  autoComplete="off"
                  spellCheck="false"
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </div>
            </div>
          )}

          {totpWanted && (
            <div className="totp-login" data-reveal>
              <div className="totp-login-head">
                <span className="totp-login-title">
                  <Smartphone size={13} aria-hidden="true" /> Authenticator code
                </span>
                <span className="totp-login-meta">Second step</span>
              </div>
              <p className="totp-login-hint">
                Open the app holding this account's code and type the six digits it is showing.
                A recovery code works here too, if you no longer have the device.
              </p>
              <div className="form-group">
                <label htmlFor="login-totp">Code</label>
                <input
                  id="login-totp"
                  ref={totpRef}
                  type="text"
                  className="glass-input totp-code-input"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value)}
                  placeholder="000000"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  spellCheck="false"
                />
              </div>
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                disabled={loading}
                onClick={() => { resetChallenge(); setPassword(''); }}
              >
                <RefreshCw size={13} aria-hidden="true" /> Start over
              </button>
            </div>
          )}

          <button
            type="submit"
            className="glass-btn glass-btn-primary auth-submit"
            disabled={loading || !canSubmit}
          >
            {loading
              ? <span className="spinner spinner-inline" />
              : totpWanted
                ? <><ShieldCheck size={18} aria-hidden="true" /> Verify code</>
                : method === 'pgp' && !challenge
                  ? <><KeyRound size={18} aria-hidden="true" /> Request challenge</>
                  : <><LogIn size={18} aria-hidden="true" /> Sign In</>}
          </button>
        </form>

        <p className="auth-alt">
          Don't have an account? <Link to="/register">Register</Link>
        </p>
        {/* Fused to the card's bottom edge: is this address the real store?
            Last child on purpose — the bar bleeds out to the card's edges. */}
        <MirrorCheck />
      </div>
    </div>
  );
}
