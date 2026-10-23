import { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
// Renders the QR entirely in this page, as an SVG, from a string already in
// memory. That is the only acceptable way to draw one here: a hosted QR
// generator would be handed the shared secret, and CLAUDE.md's rule that
// nothing may depend on a third party being reachable would make it useless on
// a filtered network anyway. Already a dependency — the payment address on
// OrderDetail uses the same component.
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertTriangle, Check, Copy, Key, KeyRound, Lock, RefreshCw,
  Shield, ShieldCheck, ShieldOff, Smartphone,
} from 'lucide-react';

/**
 * The security half of the profile page: the two-factor card, and the two
 * small controls the PGP card shares with it.
 *
 * Lifted out of Profile.jsx unchanged when that page was rebuilt. It is by far
 * the densest thing on the page — three mutually exclusive second factors, an
 * enrollment flow with a QR, a proof-of-control panel and a one-time reveal of
 * recovery codes — and mixing it into the page shell was most of why the shell
 * had become an undifferentiated stack of cards. Nothing here changed; only
 * where it lives did.
 */

/**
 * One PGP switch: a title, the sentence that explains what it actually does,
 * and the reason it is unavailable when it is.
 *
 * The row is a `<label>` wrapping the control, so the whole thing is the hit
 * target — these sit close together on a phone and a 16px checkbox is not a
 * reasonable thing to ask someone to hit.
 */
function PgpOption({ id, icon: Icon, title, hint, warning, checked, disabled, disabledNote, onChange }) {
  return (
    <div className={`pgpu-option${disabled ? ' is-disabled' : ''}${checked && !disabled ? ' is-on' : ''}`}>
      {/* The input is nested, so the association is implicit — adding `for` as
          well is the classic way to make one click toggle twice. */}
      <label className="pgpu-option-main">
        <span className="pgpu-option-icon"><Icon size={15} aria-hidden="true" /></span>
        <span className="pgpu-option-text">
          <span className="pgpu-option-title">{title}</span>
          <span className="pgpu-option-hint">{hint}</span>
          {disabled && disabledNote && <span className="pgpu-option-note">{disabledNote}</span>}
          {!disabled && warning && <span className="pgpu-option-warn">{warning}</span>}
        </span>
        <span className="switch pgpu-option-switch">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="switch-track" />
        </span>
      </label>
    </div>
  );
}

/**
 * A copy button that says whether it worked.
 *
 * The secret and the recovery codes are the two things on this page that HAVE
 * to be transferred somewhere else before the panel closes, and a copy control
 * that gives no feedback leaves people copying twice and pasting nothing. The
 * clipboard API is unavailable on an insecure origin — a `.onion` served over
 * plain HTTP inside the tunnel is exactly that — so the failure is reported
 * plainly rather than swallowed, and every value it can copy is also on screen
 * as selectable text.
 */
function CopyButton({ value, label = 'Copy', copiedLabel = 'Copied', className = '' }) {
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      toast.error('Could not copy — select the text and copy it manually');
    }
  };

  return (
    <button type="button" className={`glass-btn glass-btn-sm totp-copy${done ? ' is-done' : ''} ${className}`} onClick={copy}>
      {done
        ? <><Check size={13} aria-hidden="true" /> {copiedLabel}</>
        : <><Copy size={13} aria-hidden="true" /> {label}</>}
    </button>
  );
}

const TWO_FACTOR_OPTIONS = [
  { key: 'disabled', label: 'Off', icon: ShieldOff },
  { key: 'pgp', label: 'PGP key', icon: KeyRound },
  { key: 'totp', label: 'Authenticator', icon: Smartphone },
];

/**
 * The three-way second factor: off, PGP key, or an authenticator app.
 *
 * One choice, not three switches, because that is what it actually is — the
 * account has exactly one second factor and picking one is picking against the
 * others. The old UI expressed the PGP half as a boolean toggle inside the PGP
 * card, which had no way to say "and this is instead of the other thing".
 *
 * Two rules are enforced here as well as on the server, because a control that
 * can be pressed and then fails is worse than one that explains itself first:
 *
 *   - PGP cannot be picked without a key on file. There would be nothing to
 *     encrypt a challenge to.
 *   - The authenticator is not chosen, it is *enrolled*. Selecting it starts a
 *     setup panel; the account's second factor does not change until a code
 *     from the app has been typed back. Storing an unconfirmed secret as
 *     "enabled" is the failure that locks someone out of their own account.
 */
function TwoFactorSection({ user, refreshUser }) {
  const active = user?.two_factor_method || 'disabled';

  const [panel, setPanel] = useState(active);
  const [enroll, setEnroll] = useState(null);       // { secret, otpauth_uri, ... }
  const [enrollCode, setEnrollCode] = useState('');
  const [codes, setCodes] = useState(null);         // shown once, then never again
  const [confirm, setConfirm] = useState(null);     // { target, password, code }
  const [busy, setBusy] = useState(false);

  // A save elsewhere on the page (or a session restored on load) moves the
  // control with the account, and abandons anything half-entered against the
  // state that no longer applies.
  useEffect(() => {
    setPanel(active);
    setEnroll(null);
    setEnrollCode('');
    setConfirm(null);
    setEnrollProof(null);
  }, [active]);

  // The proof that opened this enrollment, held until it finishes.
  //
  // Both /totp/setup and /totp/confirm demand proof of account control, because
  // enrolling a factor on a stolen session is permanent denial: the owner's
  // password then reaches a prompt only the thief's authenticator answers. The
  // enrollment code cannot serve as that proof — the server refuses `code` while
  // the account's method is not yet 'totp', since the secret being enrolled is
  // the very thing in question — so a password (or a key-only account's
  // challenge answer) has to reach both calls.
  //
  // Carrying it rather than asking twice: the alternative is a second password
  // prompt between scanning the QR and typing the first code, which reads as a
  // bug. Its lifetime is the same as the confirm panel's own `password` field,
  // and the effect that watches `active` clears it with everything else.
  const [enrollProof, setEnrollProof] = useState(null);

  const startEnrollment = async (proof = {}) => {
    // Only a plain proof object may reach the wire. This button was once
    // wired as `onClick={startEnrollment}`, which passes the click EVENT as
    // `proof` — JSON.stringify then walks the DOM node's React fiber and
    // throws "Converting circular structure to JSON" before the request even
    // leaves. The guard makes any future mis-wiring degrade to an empty
    // proof (a clean `confirmation_required` from the server) instead.
    if (typeof proof !== 'object' || proof === null || typeof proof.preventDefault === 'function') {
      proof = {};
    }
    setBusy(true);
    try {
      const data = await api.post('/auth/totp/setup', proof);
      setEnroll(data);
      setEnrollProof(proof);
      setEnrollCode('');
      setCodes(null);
      setConfirm(null);
    } catch (err) {
      toast.error(err.message);
      setEnrollProof(null);
      setPanel(active);
      setConfirm(null);
    }
    setBusy(false);
  };

  const selectOption = (key) => {
    if (key === panel) return;
    setConfirm(null);
    setCodes(null);

    if (key === 'pgp' && !user?.has_pgp_key) {
      toast.error('Add a PGP public key below first — a challenge has to be encrypted to something.');
      return;
    }

    setPanel(key);

    // Leaving a live authenticator behind costs a confirmation: the server
    // asks for the password or a code, and the panel below collects it.
    if (active === 'totp' && key !== 'totp') {
      setConfirm({ target: key, password: '', code: '' });
      return;
    }
    // Turning an authenticator ON costs a confirmation too, not just turning
    // one off. Enrollment used to call /totp/setup straight from here with an
    // empty body, which the server answers with `confirmation_required` — so
    // picking TOTP produced an error toast and no way forward. The panel that
    // already collects proof for the other three actions collects it here too.
    if (key === 'totp') {
      setConfirm({ target: 'totp', password: '', code: '' });
      return;
    }
    applyMethod(key);
  };

  const applyMethod = async (target, proof = {}) => {
    setBusy(true);
    try {
      await api.put('/auth/two-factor', { method: target, ...proof });
      toast.success(target === 'disabled'
        ? 'Two-factor authentication turned off'
        : 'Your PGP key is now your second factor');
      setConfirm(null);
      setCodes(null);
      await refreshUser();
    } catch (err) {
      toast.error(err.message);
      setPanel(active);
      setConfirm(null);
    }
    setBusy(false);
  };

  const confirmEnrollment = async () => {
    setBusy(true);
    try {
      const data = await api.post('/auth/totp/confirm', { code: enrollCode.trim(), ...(enrollProof || {}) });
      // The only time these exist in the clear. The panel stays open until the
      // user dismisses it, rather than closing on a refresh and taking them
      // with it.
      setCodes(data.recovery_codes || []);
      setEnroll(null);
      setEnrollCode('');
      setEnrollProof(null);
      toast.success('Authenticator enabled');
      await refreshUser();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  const regenerateCodes = async (proof) => {
    setBusy(true);
    try {
      const data = await api.post('/auth/totp/recovery-codes', proof);
      setCodes(data.recovery_codes || []);
      setConfirm(null);
      toast.success('New recovery codes issued — the old ones no longer work');
      await refreshUser();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  const submitConfirm = () => {
    const proof = {};
    if (confirm.password) proof.password = confirm.password;
    else if (confirm.code) proof.code = confirm.code.trim();
    if (confirm.target === 'regenerate') return regenerateCodes(proof);
    if (confirm.target === 'totp') return startEnrollment(proof);
    return applyMethod(confirm.target, proof);
  };

  const remaining = user?.recovery_codes_remaining ?? 0;

  // `id` is a link target, not decoration: the sessions list at the bottom of
  // this page sends someone here when there is nothing to revoke, and DESIGN §9
  // asks that a screen with nothing on it still point somewhere.
  return (
    <div className="glass-card totp-card" id="two-factor" style={{ marginBottom: 'var(--sp-6)' }}>
      <div className="totp-head">
        <h3 className="totp-title"><Shield size={18} aria-hidden="true" /> Two-Factor Authentication</h3>
        <span className={`totp-status totp-status-${active}`}>
          {active === 'disabled'
            ? <><ShieldOff size={11} aria-hidden="true" /> Off</>
            : active === 'pgp'
              ? <><KeyRound size={11} aria-hidden="true" /> PGP key</>
              : <><Smartphone size={11} aria-hidden="true" /> Authenticator</>}
        </span>
      </div>

      <p className="totp-lede">
        A second step after your password, so a stolen password on its own is not enough.
        Pick one — they are alternatives, not additions.
      </p>

      <div className="segmented totp-segmented" role="tablist" aria-label="Two-factor method">
        {TWO_FACTOR_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const selected = panel === opt.key;
          const unavailable = opt.key === 'pgp' && !user?.has_pgp_key;
          return (
            <button
              key={opt.key}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={busy}
              className={`segmented-option totp-option${selected ? ' active' : ''}${unavailable ? ' is-unavailable' : ''}`}
              onClick={() => selectOption(opt.key)}
            >
              <Icon size={13} aria-hidden="true" /> {opt.label}
              {active === opt.key && <span className="totp-option-dot" aria-label="current setting" />}
            </button>
          );
        })}
      </div>

      {/* One panel at a time, keyed so switching re-runs the entrance
          transition instead of swapping content under a static frame. */}
      <div className="totp-panel" key={panel} data-panel={panel}>
        {panel === 'disabled' && (
          <p className="totp-panel-lede">
            Only your password is asked for at sign-in. If that password is ever guessed, pasted
            into the wrong box, or reused somewhere that leaked, there is nothing else in the way.
          </p>
        )}

        {panel === 'pgp' && (
          <>
            <p className="totp-panel-lede">
              After your password, the store encrypts a one-time token to your public key.
              You decrypt it in your own PGP client and paste the token back.
            </p>
            <p className="totp-note">
              <ShieldCheck size={13} aria-hidden="true" />
              <span>
                The server only ever holds your <b>public</b> key, so a copy of this database gives
                nobody a way past this step.
              </span>
            </p>
          </>
        )}

        {panel === 'totp' && active !== 'totp' && (
          <>
            <p className="totp-panel-lede">
              A six-digit code from an app on your own device, changing every 30 seconds.
              Any app implementing RFC 6238 will do — the secret below is standard, with nothing
              store-specific about it, so whichever authenticator you already have works and
              nothing here needs an app store to be reachable.
            </p>

            {enroll ? (
              <div className="totp-enroll" data-reveal>
                <p className="totp-warn">
                  <AlertTriangle size={13} aria-hidden="true" />
                  <span>
                    The label in the link below is <b>{enroll.issuer}</b> rather than this store's
                    name, because several popular authenticators copy that label into their own
                    cloud backup — and a backup that says which store you have an account with is
                    exactly the thing worth not sending anywhere. Edit it to whatever you like
                    before saving it; only the secret matters.
                  </span>
                </p>

                {/* The QR is a convenience on top of the text below it, never
                    instead of it. A camera, a scanner that works, and enough
                    light are three assumptions this store does not get to
                    make, so the secret and the URI are always on screen as
                    selectable text and either one enrolls the account on its
                    own. The white plate is deliberate and not a theme miss:
                    scanners need the light-module contrast, so it is painted
                    the same way in both palettes. */}
                <div className="totp-qr-row">
                  <div className="totp-qr" aria-hidden="true">
                    <QRCodeSVG value={enroll.otpauth_uri} size={132} level="M" includeMargin={false} />
                  </div>
                  <p className="totp-qr-note">
                    Scan this with your authenticator, or enter the secret below by hand.
                    It is drawn here in your browser — the secret is not sent anywhere to
                    make this image.
                  </p>
                </div>

                <div className="totp-field">
                  <div className="totp-field-head">
                    <span className="totp-field-label" id="totp-secret-label">Secret key</span>
                    <CopyButton value={enroll.secret} label="Copy secret" />
                  </div>
                  {/* Grouped in fours and allowed to wrap, rather than sitting
                      in a single-line input. Thirty-two monospaced characters
                      do not fit the width this page actually gets on a phone,
                      and an input that scrolls sideways hides most of the thing
                      the user is trying to read off the screen and type into
                      another device. `user-select: all` makes one click take
                      the whole value for anyone whose browser has no working
                      clipboard API — a `.onion` over plain HTTP is an insecure
                      origin, where the copy button cannot work at all. */}
                  <code
                    className="totp-secret"
                    id="totp-secret"
                    tabIndex={0}
                    aria-labelledby="totp-secret-label"
                  >
                    {enroll.secret.replace(/(.{4})/g, '$1 ').trim()}
                  </code>
                  <p className="totp-hint">
                    Type this into your app's "enter a setup key" option — the spaces are only
                    there to make it readable. {enroll.digits} digits, every {enroll.period} seconds,
                    SHA1: the defaults every app already uses.
                  </p>
                </div>

                <div className="totp-field">
                  <div className="totp-field-head">
                    <label htmlFor="totp-uri">Setup link</label>
                    <CopyButton value={enroll.otpauth_uri} label="Copy link" />
                  </div>
                  <textarea
                    id="totp-uri"
                    className="glass-input totp-uri"
                    value={enroll.otpauth_uri}
                    readOnly
                    rows={4}
                    spellCheck="false"
                    onFocus={(e) => e.target.select()}
                  />
                  <p className="totp-hint">
                    On a phone, <a className="totp-uri-link" href={enroll.otpauth_uri}>opening this link</a> hands
                    it straight to an installed authenticator, with no camera involved.
                  </p>
                </div>

                <div className="form-group totp-verify">
                  <label htmlFor="totp-code">Code from your app</label>
                  <input
                    id="totp-code"
                    className="glass-input totp-code-input"
                    value={enrollCode}
                    onChange={(e) => setEnrollCode(e.target.value.replace(/[^\d]/g, '').slice(0, 6))}
                    placeholder="000000"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    spellCheck="false"
                  />
                  <p className="totp-hint">
                    Nothing changes about how you sign in until this code is accepted.
                  </p>
                </div>

                <div className="totp-actions">
                  <button
                    type="button"
                    className="glass-btn glass-btn-primary glass-btn-sm"
                    disabled={busy || enrollCode.trim().length < 6}
                    onClick={confirmEnrollment}
                  >
                    {busy ? <span className="spinner spinner-inline" /> : <Check size={13} aria-hidden="true" />}
                    Verify and turn on
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" disabled={busy} onClick={() => { setEnroll(null); setPanel(active); }}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="totp-actions">
                {/* Opens the proof panel rather than calling the API bare:
                    /totp/setup demands proof of account control, and passing
                    this handler the click event used to send the DOM node as
                    the request body. */}
                <button
                  type="button"
                  className="glass-btn glass-btn-primary glass-btn-sm"
                  disabled={busy}
                  onClick={() => setConfirm({ target: 'totp', password: '', code: '' })}
                >
                  {busy ? <span className="spinner spinner-inline" /> : <Smartphone size={13} aria-hidden="true" />}
                  Set up an authenticator
                </button>
              </div>
            )}
          </>
        )}

        {panel === 'totp' && active === 'totp' && (
          <>
            <p className="totp-panel-lede">
              <span className="totp-live" aria-hidden="true" />
              Your authenticator is active. Sign-in asks for a six-digit code after your password.
            </p>
            <div className="totp-recovery-state">
              <span className={`totp-recovery-count${remaining === 0 ? ' is-empty' : remaining <= 3 ? ' is-low' : ''}`}>
                {remaining} recovery {remaining === 1 ? 'code' : 'codes'} left
              </span>
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                disabled={busy}
                onClick={() => { setCodes(null); setConfirm({ target: 'regenerate', password: '', code: '' }); }}
              >
                <RefreshCw size={13} aria-hidden="true" /> New recovery codes
              </button>
            </div>
            <p className="totp-hint">
              Recovery codes are the way back in if the device generating your codes is lost.
              Issuing a new set immediately invalidates the old one.
            </p>
          </>
        )}
      </div>

      {/* Confirmation, for the two actions that can take a working second
          factor away from someone. */}
      {confirm && (
        <div className="totp-confirm" data-reveal role="group" aria-label="Confirm this change">
          <p className="totp-confirm-lede">
            <Lock size={13} aria-hidden="true" />
            {confirm.target === 'regenerate'
              && 'Confirm it is you before the old recovery codes stop working.'}
            {confirm.target === 'totp'
              && 'Confirm it is you before enrolling an authenticator. Anyone who enrols one becomes the only person who can sign in, so this asks for more than an open session.'}
            {confirm.target !== 'regenerate' && confirm.target !== 'totp'
              && 'Confirm it is you before your authenticator is removed. The secret is deleted, so turning it back on means enrolling the device again.'}
          </p>
          <div className="form-group">
            <label htmlFor="totp-confirm-password">Your password</label>
            <input
              id="totp-confirm-password"
              type="password"
              className="glass-input"
              value={confirm.password}
              onChange={(e) => setConfirm((c) => ({ ...c, password: e.target.value, code: '' }))}
              autoComplete="current-password"
            />
          </div>
          {/* Offered only where it can actually work. While enrolling, the
              account's method is not yet 'totp', and the server refuses a
              `code` as proof in that state precisely because the secret it
              would be checked against is the one being enrolled — so showing
              the field here would invite an answer that is always rejected. */}
          {confirm.target !== 'totp' && (
            <>
              <div className="totp-or"><span>or</span></div>
              <div className="form-group">
                <label htmlFor="totp-confirm-code">A code from your authenticator, or a recovery code</label>
                <input
                  id="totp-confirm-code"
                  className="glass-input totp-code-input"
                  value={confirm.code}
                  onChange={(e) => setConfirm((c) => ({ ...c, code: e.target.value, password: '' }))}
                  placeholder="000000"
                  autoComplete="one-time-code"
                  spellCheck="false"
                />
              </div>
            </>
          )}
          <div className="totp-actions">
            <button
              type="button"
              className="glass-btn glass-btn-primary glass-btn-sm"
              disabled={busy || (!confirm.password && !confirm.code.trim())}
              onClick={submitConfirm}
            >
              {busy ? <span className="spinner spinner-inline" /> : <Check size={13} aria-hidden="true" />}
              Confirm
            </button>
            <button type="button" className="glass-btn glass-btn-sm" disabled={busy} onClick={() => { setConfirm(null); setPanel(active); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Shown once. The server keeps only bcrypt hashes from the moment these
          are generated, so there is no "show them again" to offer. */}
      {codes && (
        <div className="totp-codes" data-reveal role="group" aria-label="Recovery codes">
          <div className="totp-codes-head">
            <span className="totp-codes-title"><Key size={13} aria-hidden="true" /> Recovery codes</span>
            <CopyButton value={codes.join('\n')} label="Copy all" copiedLabel="Copied all" />
          </div>
          <p className="totp-warn">
            <AlertTriangle size={13} aria-hidden="true" />
            <span>
              This is the only time these are shown. Write them down somewhere that is not the
              device running your authenticator. Each one works once.
            </span>
          </p>
          <ol className="totp-codes-list">
            {codes.map((code) => <li key={code}><code>{code}</code></li>)}
          </ol>
          <div className="totp-actions">
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => setCodes(null)}>
              <Check size={13} aria-hidden="true" /> I have saved these
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export { PgpOption, CopyButton, TwoFactorSection };
export default TwoFactorSection;
