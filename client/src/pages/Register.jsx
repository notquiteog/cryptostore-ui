import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import BrandMark from '../components/BrandMark';
import MirrorCheck from '../components/MirrorCheck';
import { countSignupView } from '../components/RefCapture';
import { getRefTag } from '../utils/refTag';
import toast from 'react-hot-toast';
import { UserPlus, Lock, Ticket, LogIn, UserCheck } from 'lucide-react';

/**
 * ── The invite box, and when it is not there ────────────────────────────────
 *
 * Somebody arriving on `alice`'s tracking link should not have to know that a
 * code exists, let alone copy one into a form. When the page can prove who
 * sent them it says so in a sentence, keeps the code out of sight, and posts
 * it for them — the form has one fewer field and one fewer way to go wrong.
 *
 * The box comes back for everybody else, and "everybody else" is a real
 * population rather than an edge case. A link cleaner strips `?ref=` before
 * the page ever loads. A privacy browser refuses localStorage, so a tag
 * captured on the landing page is gone by the time they reach this one. A
 * printed link gets typed by hand and the query string never survives. A
 * resolver call is refused by a rate limiter. In every one of those the
 * visitor still has the tag written down somewhere and can type it, so the
 * manual field is not a fallback for the paranoid — it is the path a good
 * fraction of real signups take, and it accepts the friendly tag as readily
 * as the generated code because the server resolves both.
 *
 * The one rule that does not bend: an unresolvable tag never silently becomes
 * a blank form. A visitor who followed somebody's link and ends up attributed
 * to nobody has cost that person a referral without either of them being told.
 * The box comes back WITH the tag already in it and a line saying it could not
 * be checked, so the failure is visible and recoverable.
 */

/** The four things `GET /marketing/ref` can say about a link that is not live. */
const DEAD_REASONS = {
  expired: 'That invite link has expired.',
  exhausted: 'That invite link has been used the maximum number of times.',
  revoked: 'That invite link is no longer active.',
  unknown: 'We could not check that referral link.',
};

export default function Register() {
  const { register } = useAuth();
  const { settings, loaded } = useTheme();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pgpKey, setPgpKey] = useState('');
  const [showPgp, setShowPgp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [searchParams] = useSearchParams();

  // What the `?ref=` this visitor arrived with resolved to.
  //   null      — still asking, or there was no tag to ask about
  //   { valid } — the answer, either way
  const [ref, setRef] = useState(null);
  const [refChecked, setRefChecked] = useState(false);

  useEffect(() => {
    // `?invite=` is the original spelling and every link ever handed out still
    // uses it, so it keeps working and keeps filling the box. It is not
    // resolved against the server: it was always a code typed into a field,
    // and treating it as a tracking link would change what a year-old link
    // does.
    const code = searchParams.get('invite');
    if (code) setInviteCode(code);
  }, [searchParams]);

  useEffect(() => {
    // `RefCapture` has already taken the tag out of the URL and stored it, so
    // this reads the store rather than the address bar — by now there is
    // nothing in the address bar to read. It also means a visitor who landed
    // on the shop days ago and is only now signing up is still attributed.
    const tag = getRefTag();
    if (!tag) { setRefChecked(true); return; }

    // The step between "arrived" and "signed up". Fired here rather than from
    // RefCapture because it is about reaching THIS page, which for most
    // visitors happens on a later navigation with no query string left.
    countSignupView();

    let cancelled = false;
    fetch(`/api/marketing/ref?ref=${encodeURIComponent(tag)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setRef(data);
        // Fill the box even when the link is dead or unresolvable. If the page
        // cannot vouch for the tag it hands it back to the visitor rather than
        // dropping it, and the server gets the final say on submit.
        if (data?.valid) setInviteCode(data.code);
        else setInviteCode((current) => current || tag);
      })
      .catch(() => {
        // Rate-limited, offline, or the endpoint is unreachable. Same
        // treatment: the tag goes in the box and the person can submit it.
        if (!cancelled) setInviteCode((current) => current || tag);
      })
      .finally(() => { if (!cancelled) setRefChecked(true); });

    return () => { cancelled = true; };
  }, []);

  // The one condition under which the field is not drawn: the store told us
  // whose link this is, so there is nothing for the visitor to decide.
  const inviteResolved = !!ref?.valid;

  // Registration policy, as the store currently has it configured. The server
  // enforces all of this again — this only spares the visitor filling in a form
  // that was never going to be accepted.
  const registrationOpen = settings.registration_enabled !== 'false';
  const inviteRequired = settings.require_invite === 'true';
  const inviteSource = settings.registration_invite_source || 'any';

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      return toast.error('Passwords do not match');
    }
    if (inviteRequired && !inviteCode.trim()) {
      return toast.error('An invite code is required to register');
    }
    setLoading(true);
    try {
      await register(username, password, showPgp ? pgpKey : undefined, inviteCode || undefined);
      toast.success('Account created!');
      navigate('/');
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  // Wait for settings before deciding: flashing "closed" at somebody who can in
  // fact register is worse than a beat of blank.
  if (!loaded) return null;

  if (!registrationOpen) {
    return (
      <div className="page auth-page">
        <div aria-hidden="true" className="auth-glow" />
        <div className="glass-card auth-card" style={{ textAlign: 'center' }}>
          <div className="auth-lock-badge">
            <Lock size={22} />
          </div>
          <h2 className="auth-title">Registration closed</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-base)', lineHeight: 1.6, margin: '0 0 1.5rem' }}>
            {(settings.registration_closed_message || '').trim()
              || 'This store is not accepting new accounts at the moment. Please check back later.'}
          </p>
          <Link to="/login" className="glass-btn glass-btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
            <LogIn size={16} /> Sign in to an existing account
          </Link>
          <MirrorCheck />
        </div>
      </div>
    );
  }

  return (
    <div className="page auth-page">
      {/* Ambient glow */}
      <div aria-hidden="true" className="auth-glow" />
      <div className="glass-card auth-card">
        {/* The mark, not a caption — same rule as Login. The invite-only
            notice below already explains itself, so no subtitle is lost. */}
        <BrandMark />
        <h2 className="sr-only">Create account</h2>

        {inviteRequired && (
          <div className="auth-notice">
            <Ticket size={15} style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
            <span>
              {inviteSource === 'admin'
                ? 'An invite code from the store is required to create an account.'
                : inviteSource === 'user'
                  ? 'An invite link from an existing customer is required to create an account.'
                  : 'An invite code is required to create an account.'}
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              className="glass-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              required
              autoComplete="username"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              className="glass-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label>Confirm Password</label>
            <input
              type="password"
              className="glass-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              required
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <button type="button" onClick={() => setShowPgp(!showPgp)}
              className="glass-btn glass-btn-sm" style={{ marginBottom: 'var(--sp-2)' }}>
              {showPgp ? 'Hide PGP' : 'Add PGP Public Key (optional)'}
            </button>
            {showPgp && (
              <textarea
                className="glass-input"
                value={pgpKey}
                onChange={(e) => setPgpKey(e.target.value)}
                placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
                rows={4}
                style={{ fontFamily: 'monospace', fontSize: 'var(--fs-sm)' }}
              />
            )}
          </div>

          {/* Three states, one slot.

              Resolved — a card naming who sent them, and no field at all: the
              code rides in state and is posted for them. Drawn as a statement
              rather than as a disabled input, because a greyed-out box with a
              code in it invites somebody to try to change it and then tells
              them no. §7: a control nobody can press is not a control.

              Dead or unchecked — the field, pre-filled with the tag they
              arrived on and a line saying what happened. Never a blank form:
              silently dropping the tag costs the person who shared the link a
              referral, and neither of them ever finds out.

              No tag at all — the field, as it has always been. */}
          {inviteResolved ? (
            <div className="invite-vouched">
              <span className="invite-vouched-badge" aria-hidden="true"><UserCheck size={16} /></span>
              <div className="invite-vouched-body">
                <p className="invite-vouched-line">
                  {ref.referrer_username
                    ? <>Invited by <strong>{ref.referrer_username}</strong></>
                    : <>You are signing up through a store invite</>}
                </p>
                <p className="invite-vouched-note">
                  {ref.referrer_username
                    ? 'Your account will be linked to theirs, and your invite code is already filled in.'
                    : 'Your invite code is already filled in — there is nothing to enter.'}
                  {ref.price_markup_value > 0 && (
                    <>
                      {' '}They set a{' '}
                      <span className="invite-vouched-markup">
                        {/* Characters, not icons.
                            `%` and `$` are punctuation that happens to have
                            lucide components named after them, and using the
                            components cost this line twice. Visually, both
                            were first written with the glyph leading and the
                            percentage rendered as "%15 on top" — the symbol
                            goes where the unit goes, and that is not the same
                            side for the two kinds. And an `aria-hidden` icon
                            is not read at all, so a screen reader heard "they
                            set a 15 on the prices you will see": a number with
                            no unit, in a sentence about what somebody is about
                            to be charged. */}
                        {ref.price_markup_kind === 'amount'
                          ? `$${ref.price_markup_value.toFixed(2)} per item`
                          : `${ref.price_markup_value}%`}
                      </span>
                      {' '}on the prices you will see.
                    </>
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="form-group">
              <label htmlFor="invite-code">
                Invite Code{' '}
                {!inviteRequired && (
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: 'var(--fs-base)' }}>(optional)</span>
                )}
              </label>
              <input
                id="invite-code"
                className="glass-input"
                style={{ width: '100%' }}
                value={inviteCode}
                onChange={e => setInviteCode(e.target.value)}
                placeholder={inviteRequired ? 'Required — paste your invite code' : 'Enter invite code or referral tag'}
                required={inviteRequired}
              />
              {/* Only once the answer is actually in. Saying "we could not
                  check that" while the request is still in flight would be
                  reporting a failure that has not happened. */}
              {refChecked && ref && !ref.valid && (
                <p className="form-hint form-hint-warn">
                  {DEAD_REASONS[ref.reason] || DEAD_REASONS.unknown}{' '}
                  You can still register — check the code above, or clear it to sign up without one.
                </p>
              )}
            </div>
          )}

          <button type="submit" className="glass-btn glass-btn-primary"
            style={{ width: '100%', marginBottom: 'var(--sp-4)' }}
            disabled={loading}>
            {loading ? <span className="spinner" /> : <><UserPlus size={18} /> Create Account</>}
          </button>
        </form>

        <p style={{ textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--fs-base)' }}>
          Already have an account? <Link to="/login">Sign In</Link>
        </p>
        {/* Fused to the card's bottom edge, as on the sign-in card. */}
        <MirrorCheck />
      </div>
    </div>
  );
}
