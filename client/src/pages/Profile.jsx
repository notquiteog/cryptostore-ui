import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import { initPushNotifications, subscribePush, unsubscribePush, isPushSubscribed } from '../utils/push';
import toast from 'react-hot-toast';
import {
  Bell, Check, ClipboardList, Heart, Key, KeyRound, LifeBuoy, Lock, MessageCircle,
  Save, Shield, ShieldCheck, Volume2, Wallet, Send, Award, Link2, Gift, Download, Trash2,
} from 'lucide-react';
import { playSound, soundsMuted, setSoundsMuted } from '../utils/sounds';
import { checkPublicKeyBlock } from '../utils/armor';
import TwoFactorSection, { PgpOption } from '../components/profile/TwoFactorSection';
import SessionList from '../components/profile/SessionList';
import AvatarEditor from '../components/profile/AvatarEditor';
import CompanionChoice from '../components/profile/CompanionChoice';
import AiConsentSection from '../components/profile/AiConsentSection';

/**
 * The account page.
 *
 * ── What this replaced, and why the shape changed ─────────────────────────
 *
 * Eight `.glass-card`s stacked in a 700px centred column, in the order they
 * happened to be written: account info, sounds, password, two-factor, PGP,
 * Telegram, Potato, notifications, sessions. Every card the same width, the
 * same elevation and the same weight, on a monitor with half of it empty —
 * DESIGN §1's "centred column, enormous vertical padding" and "one elevation
 * for everything" in one page. Nothing on it said which of nine settings
 * mattered, and the two most consequential controls in the app (your second
 * factor, and the list of devices that can act as you) sat between a volume
 * switch and a checkbox about push notifications.
 *
 * What it is now, by §7's "group by task, not by table schema":
 *
 *   IDENTITY   Who this account is to other people — the picture, the name,
 *              the role and tier, what it can pay with. Full width, because
 *              it is the page's subject and because the avatar editor is the
 *              one genuinely new thing here.
 *
 *   GETTING IN Password, second factor, PGP, signed-in devices. The heavy
 *              column, and the wide one: these are long, they are dangerous,
 *              and they are why people open this page.
 *
 *   REACHING   Bots, notifications, sounds. A rail — short rows, low stakes,
 *              read once and left alone.
 *
 * The two columns are a CONTAINER query, not a viewport one (§5). This page
 * renders inside the storefront shell today and could sit inside a narrower
 * panel tomorrow; a viewport query would put the wide layout in the narrow
 * place, which is the exact inversion §5 warns about.
 */

/** How long this account has existed, in the unit that is actually useful. */
function memberSince(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * One switch row: a label, the sentence that says what it does, and the
 * control. Every preference on this page is this shape, which is what stops
 * the notification card being twelve unlabelled checkboxes at one weight.
 */
function SwitchRow({ id, title, hint, checked, onChange, disabled }) {
  return (
    <div className={`prof-switch${disabled ? ' is-disabled' : ''}`}>
      <div className="prof-switch-text">
        <label htmlFor={id} className="prof-switch-title">{title}</label>
        {hint && <p className="prof-switch-hint">{hint}</p>}
      </div>
      <label className="switch">
        <input
          id={id}
          type="checkbox"
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="switch-track" />
      </label>
    </div>
  );
}

/**
 * A bot channel — Telegram or Potato — as one row rather than a card each.
 *
 * They were two near-identical 45-line cards that differed in one word and in
 * whether a deep link existed. Two copies of a thing that is the same thing is
 * how the Telegram card got an "Open in Telegram" button and the Potato one
 * silently did not grow its equivalent; one component with a `deepLink` prop
 * makes that difference visible instead of accidental.
 */
function BotChannel({ name, icon: Icon, linked, onLink, onUnlink, pending, deepLinkLabel }) {
  return (
    <div className="prof-channel">
      <div className="prof-channel-head">
        <span className="prof-channel-name">
          <Icon size={15} aria-hidden="true" /> {name}
          {linked && <span className="badge badge-success prof-here">linked</span>}
        </span>
        {linked ? (
          <button type="button" className="glass-btn glass-btn-sm" onClick={onUnlink}>Unlink</button>
        ) : (
          <button type="button" className="glass-btn glass-btn-sm" onClick={onLink}>Link</button>
        )}
      </div>
      {!linked && pending && (
        <div className="prof-channel-pending" data-reveal>
          <p className="prof-switch-hint">{pending.message}</p>
          {pending.deep_link && (
            <a
              href={pending.deep_link}
              target="_blank"
              rel="noopener noreferrer"
              className="glass-btn glass-btn-sm glass-btn-primary"
            >
              {deepLinkLabel}
            </a>
          )}
          {/* Telegram's link carries the code; Potato's opens the bot and
              carries nothing (its API documents no start parameter — see
              authController.getPotatoLink), so the command is still the
              path and has to be selectable rather than merely printed. */}
          {(!pending.deep_link || pending.deep_link_needs_code) && (
            <code className="prof-code" tabIndex={0}>/start {pending.link_code}</code>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Redeem a store-credit voucher onto this account. One field, one button,
 * and the balance above it moves. The code is normalised server-side, so a
 * voucher read off paper with the dashes dropped still lands.
 */
function VoucherRedeem({ onRedeemed }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    try {
      const r = await api.post('/subusers/credit/redeem-voucher', { code });
      playSound('success');
      toast.success(`Voucher ${r.hint} redeemed — +$${Number(r.amount).toFixed(2)} store credit`);
      setCode('');
      setOpen(false);
      onRedeemed?.();
    } catch (err) {
      playSound('error');
      toast.error(err.message || 'Could not redeem that voucher');
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <button type="button" className="prof-voucher-toggle" onClick={() => setOpen(true)}>
        <Gift size={13} aria-hidden="true" /> Redeem a credit voucher
      </button>
    );
  }
  return (
    <form className="prof-voucher" onSubmit={submit}>
      <input
        className="glass-input"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="SC-XXXX-XXXX-XXXX"
        aria-label="Voucher code"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck="false"
      />
      <button type="submit" className="glass-btn glass-btn-sm glass-btn-primary" disabled={busy || !code.trim()}>
        {busy ? 'Redeeming…' : 'Redeem'}
      </button>
      <button type="button" className="glass-btn glass-btn-sm" onClick={() => setOpen(false)}>Cancel</button>
    </form>
  );
}

function YourData() {
  const { user, logout } = useAuth();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    let alive = true;
    api.get('/profiles/me/export-status').then((d) => { if (alive) setStatus(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const download = async () => {
    setBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/profiles/me/export', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error || `HTTP ${res.status}`); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = status?.signed ? `account-${user?.username}.json.asc` : `account-${user?.username}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(status?.signed ? 'Exported and signed by the store key' : 'Exported');
    } catch (err) {
      toast.error(err.message || 'Could not export');
    } finally {
      setBusy(false);
    }
  };

  const erase = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/profiles/me/erase', { password, confirm });
      toast.success('Your account has been erased.');
      logout?.();
      window.location.assign('/');
    } catch (err) {
      toast.error(err.message || 'Could not erase the account');
      setBusy(false);
    }
  };

  const staff = ['admin', 'manager'].includes(user?.role);

  return (
    <section className="glass-card prof-card">
      <div className="prof-card-head">
        <div className="prof-card-title">
          <h3><Download size={17} aria-hidden="true" /> Your data</h3>
        </div>
      </div>
      <p className="prof-hint">
        Everything the store holds on this account — orders and their lines, credit ledger, reviews,
        support threads — as one JSON file.
        {status?.signed
          ? ' It is signed by the store key, so it is evidence of what the store held, not just a file.'
          : status ? ` Unsigned: ${status.reason || 'the store cannot sign unattended.'}` : ''}
      </p>
      <div className="prof-data-actions">
        <button type="button" className="glass-btn glass-btn-sm" onClick={download} disabled={busy}>
          <Download size={13} aria-hidden="true" /> {busy ? 'Working…' : status?.signed ? 'Download signed export' : 'Download export'}
        </button>
        {!staff && !erasing && (
          <button type="button" className="glass-btn glass-btn-sm glass-btn-danger" onClick={() => setErasing(true)} disabled={busy}>
            <Trash2 size={13} aria-hidden="true" /> Erase this account
          </button>
        )}
      </div>
      {erasing && (
        <form className="prof-erase" onSubmit={erase}>
          <p className="prof-hint">
            <strong>This cannot be undone.</strong> Your name, password, keys, bot links, avatar, cart and
            wishlist are removed and you can no longer sign in. Your orders stay on the store's books with
            their addresses and notes wiped — the money trail survives, the identity does not. Reviews stay,
            with no author.
            {status?.in_flight_orders > 0 && (
              <> <strong>{status.in_flight_orders} order{status.in_flight_orders === 1 ? ' is' : 's are'} still in flight</strong> — they must finish or be cancelled first.</>
            )}
          </p>
          <input className="glass-input" type="password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          <input className="glass-input" type="text" placeholder="Type ERASE" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" required />
          <div className="prof-data-actions">
            <button type="submit" className="glass-btn glass-btn-sm glass-btn-danger" disabled={busy || confirm !== 'ERASE' || !password || status?.in_flight_orders > 0}>
              <Trash2 size={13} aria-hidden="true" /> {busy ? 'Erasing…' : 'Erase my account'}
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => setErasing(false)} disabled={busy}>Keep it</button>
          </div>
        </form>
      )}
    </section>
  );
}

/**
 * Pin the rail only while the whole of it fits under the viewport.
 *
 * A sticky rail is right when it fits — the notification switches stay in
 * reach while the long security column scrolls — and wrong when it does not,
 * because a sticky box taller than the viewport strands its own bottom. The
 * stylesheet used to answer that with a max-height and an inner scroll, and
 * the flex column inside it answered THAT by shrinking every card to fit,
 * clipping the erase button and the sound switch off the bottom of their
 * cards (76-profile.css says the rest). CSS cannot compare an element to the
 * viewport, so this measures: `is-pinned` goes on when the rail's natural
 * height clears the window, and comes off when a card grows — the erase
 * form opening, a bot link's pending step — or the window shrinks.
 */
function useRailPin() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    // The rail's sticky offset plus a little air, matching `top` in the sheet.
    const OFFSET = 40;
    const check = () => {
      el.classList.toggle('is-pinned', el.scrollHeight + OFFSET <= window.innerHeight);
    };
    check();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
    ro?.observe(el);
    window.addEventListener('resize', check);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', check);
    };
  }, []);
  return ref;
}

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const railRef = useRailPin();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  // Mirrors the localStorage mute so the switch re-renders; sounds.js owns
  // the stored truth.
  const [soundsOff, setSoundsOff] = useState(() => soundsMuted());
  const [pgpKey, setPgpKey] = useState('');
  const [pgpLoginOnly, setPgpLoginOnly] = useState(user?.pgp_login_only || false);
  const [pgpEncryptAddress, setPgpEncryptAddress] = useState(user?.pgp_encrypt_address || false);
  // Turning on key-only sign-in requires proving the private key is actually
  // held — see the server handler. This is that round trip.
  const [pgpConfirm, setPgpConfirm] = useState(null); // { challenge, token }
  const [storeKey, setStoreKey] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPgp, setShowPgp] = useState(false);
  const [botSensitive, setBotSensitive] = useState(false);
  const [telegramLink, setTelegramLink] = useState(null);
  const [potatoLink, setPotatoLink] = useState(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [notifyProducts, setNotifyProducts] = useState(false);
  const [notifyOrders, setNotifyOrders] = useState(false);
  const [notifyTicketReplies, setNotifyTicketReplies] = useState(true);
  const [notifySignIns, setNotifySignIns] = useState(false);
  const [adminPrefs, setAdminPrefs] = useState(null);

  const isStaff = user && (user.role === 'admin' || user.role === 'manager');

  useEffect(() => {
    initPushNotifications().then(() => {
      isPushSubscribed().then(setPushEnabled);
    });
    api.get('/push/preferences').then(prefs => {
      setNotifyProducts(prefs.notify_new_products ?? false);
      setNotifyOrders(prefs.notify_order_updates ?? false);
      setNotifyTicketReplies(prefs.notify_ticket_replies ?? true);
      setNotifySignIns(prefs.notify_sign_ins ?? false);
      setBotSensitive(prefs.bot_sensitive_details ?? false);
    }).catch(() => {});
    if (isStaff) {
      api.get('/push/admin-preferences').then(setAdminPrefs).catch(() => {});
    }
    // Whether the store can actually encrypt an address. The toggle below says
    // so plainly rather than accepting a preference that will not take effect.
    api.get('/store-pgp/public').then(setStoreKey).catch(() => setStoreKey(null));
  }, [isStaff]);

  // The card reflects the account, so a save (or a session restored on load)
  // has to move the switches with it.
  useEffect(() => {
    setPgpLoginOnly(user?.pgp_login_only || false);
    setPgpEncryptAddress(user?.pgp_encrypt_address || false);
  }, [user?.pgp_login_only, user?.pgp_encrypt_address]);

  const updatePassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      // A password change revokes every session for this account, this one
      // included, and the server mints a replacement token for the device that
      // just changed it. The response used to be discarded, so the stale token
      // stayed in localStorage, 401'd on the very next request, and `api.js`
      // cleared it and hard-redirected to /login — the user was thrown out
      // half a second after reading "Password updated". Persisting the
      // replacement is what keeps this device signed in while every other
      // session stays denylisted, so it has to happen before anything else
      // fires a request.
      const data = await api.put('/auth/profile', { password: currentPassword, new_password: newPassword });
      if (data?.token) localStorage.setItem('token', data.token);
      toast.success('Password updated — every other device has been signed out');
      setCurrentPassword('');
      setNewPassword('');
      await refreshUser();
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  const updatePgp = async (challengeAnswer) => {
    setLoading(true);
    try {
      // Whether PGP is the second factor belongs to the two-factor card above,
      // not to this one. Sending it from here as well would give one setting
      // two owners — the classic shape where saving an unrelated switch quietly
      // reverts the other card. The server refuses the field outright now, so a
      // card that reached for it would get a 400 rather than a silent revert.
      const body = {
        pgp_login_only: pgpLoginOnly,
        pgp_encrypt_address: pgpEncryptAddress,
      };
      // Only send the key when the editor is open with something in it.
      // Sending `null` on every save would silently delete the stored key for
      // anyone who opened this card to flip a switch.
      if (showPgp) {
        // The shape check runs BEFORE the request, and its whole value is in
        // not making one: somebody with two blocks in their clipboard history
        // pastes the private one, and the difference between catching it here
        // and catching it on the server is whether the secret key was sent
        // over the network at all. The server refuses it too
        // (`pgpService.validatePublicKey`) — this is the half that means it
        // never left the tab.
        if (pgpKey) {
          const shape = checkPublicKeyBlock(pgpKey);
          if (!shape.ok) {
            toast.error(shape.message);
            setLoading(false);
            return;
          }
        }
        body.pgp_public_key = pgpKey || null;
      }
      if (challengeAnswer) body.pgp_challenge_response = challengeAnswer;

      const res = await api.put('/auth/profile', body);

      // 202: the server wants the key proved before it will make it mandatory.
      if (res?.requires_pgp && res.pgp_challenge) {
        setPgpConfirm({ challenge: res.pgp_challenge, token: '' });
        toast('Decrypt the block below to confirm you hold this private key');
        setLoading(false);
        return;
      }

      setPgpConfirm(null);
      setShowPgp(false);
      setPgpKey('');
      toast.success('PGP settings updated');
      await refreshUser();
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  const linkTelegram = async () => {
    try { setTelegramLink(await api.get('/auth/telegram-link')); }
    catch (err) { toast.error(err.message); }
  };
  const unlinkTelegram = async () => {
    try {
      await api.delete('/auth/telegram-link');
      toast.success('Telegram account unlinked');
      await refreshUser();
    } catch (err) { toast.error(err.message); }
  };
  const linkPotato = async () => {
    try { setPotatoLink(await api.get('/auth/potato-link')); }
    catch (err) { toast.error(err.message); }
  };
  const unlinkPotato = async () => {
    try {
      await api.delete('/auth/potato-link');
      toast.success('Potato account unlinked');
      await refreshUser();
    } catch (err) { toast.error(err.message); }
  };

  const togglePush = async (on) => {
    try {
      if (!on) {
        await unsubscribePush();
        setPushEnabled(false);
        toast.success('Push notifications disabled');
      } else {
        await subscribePush();
        setPushEnabled(true);
        toast.success('Push notifications enabled');
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const updateNotifyPrefs = async (field, value) => {
    try {
      await api.put('/push/preferences', { [field]: value });
      if (field === 'notify_new_products') setNotifyProducts(value);
      if (field === 'notify_order_updates') setNotifyOrders(value);
      if (field === 'notify_ticket_replies') setNotifyTicketReplies(value);
      if (field === 'notify_sign_ins') setNotifySignIns(value);
      if (field === 'bot_sensitive_details') setBotSensitive(value);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const updateAdminPrefs = async (field, value) => {
    try {
      const updated = { ...adminPrefs, [field]: value };
      await api.put('/push/admin-preferences', updated);
      setAdminPrefs(updated);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const since = memberSince(user?.created_at);
  const payMethods = [
    user?.cash_in_mail_enabled && 'cash in mail',
    user?.zelle_enabled && 'Zelle',
  ].filter(Boolean);

  return (
    <div className="page container prof-page">
      {/* ── Identity ─────────────────────────────────────────────────────
          Full width and asymmetric: the picture and the name are the
          subject, the account's standing sits beside them, and the three
          places someone goes next from here are on the same line rather than
          at the bottom of a scroll (DESIGN §9). */}
      <header className="glass-card prof-identity">
        <AvatarEditor user={user} onChange={() => refreshUser()} />

        <div className="prof-identity-meta">
          <h1 className="prof-name">{user?.username}</h1>
          <div className="prof-badges">
            <span className="badge badge-primary">{user?.role}</span>
            {since && <span className="prof-dim">member since {since}</span>}
          </div>
          {/* Store credit is money, so it is printed in the ledger face and
              only when there is some — a zero balance is not news, and a
              currency figure at rest is chrome. */}
          {Number(user?.store_credit_balance) > 0 && (
            <p className="prof-credit">
              <Wallet size={14} aria-hidden="true" />
              <span className="prof-mono">${Number(user.store_credit_balance).toFixed(2)}</span> store credit
            </p>
          )}
          <VoucherRedeem onRedeemed={() => refreshUser()} />
          {payMethods.length > 0 && (
            <p className="prof-switch-hint">
              <Check size={12} aria-hidden="true" /> This account may pay by {payMethods.join(' and ')}.
            </p>
          )}
        </div>

        <nav className="prof-jump" aria-label="Where to next">
          <Link to="/orders" className="glass-btn glass-btn-sm"><ClipboardList size={14} aria-hidden="true" /> Orders</Link>
          <Link to="/wishlist" className="glass-btn glass-btn-sm"><Heart size={14} aria-hidden="true" /> Wishlist</Link>
          <Link to="/membership" className="glass-btn glass-btn-sm"><Award size={14} aria-hidden="true" /> Membership</Link>
          <Link to="/support" className="glass-btn glass-btn-sm"><LifeBuoy size={14} aria-hidden="true" /> Support</Link>
        </nav>
      </header>

      <div className="prof-columns">
        {/* ── Getting in ────────────────────────────────────────────── */}
        <div className="prof-main">
          <section className="glass-card prof-card">
            <div className="prof-card-head">
              <div className="prof-card-title">
                <h3><Key size={17} aria-hidden="true" /> Password</h3>
                <p>
                  Changing it signs out every other device at once. There is no reset link —
                  this account has no email or phone to send one to, on purpose.
                </p>
              </div>
            </div>
            <form onSubmit={updatePassword} className="prof-form">
              <div className="form-group">
                <label htmlFor="pw-current">Current password</label>
                <input id="pw-current" type="password" className="glass-input" value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
              </div>
              <div className="form-group">
                <label htmlFor="pw-new">New password</label>
                <input id="pw-new" type="password" className="glass-input" value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)} required minLength={8} autoComplete="new-password" />
              </div>
              <button type="submit" className="glass-btn glass-btn-primary" disabled={loading}>
                {loading ? <span className="spinner spinner-inline" /> : <Save size={15} aria-hidden="true" />}
                Update password
              </button>
            </form>
          </section>

          <TwoFactorSection user={user} refreshUser={refreshUser} />

          {/* ── PGP ──────────────────────────────────────────────────────
              One key, two independent decisions. They are separate switches
              because they answer different questions and have different
              stakes: key-only sign-in replaces the password outright (and can
              lock the account out if the private key is not really held), and
              address encryption is about what the store stores, not about
              getting in at all. The third decision — "use my key as my second
              factor" — lives in the two-factor card above, where it can be
              shown as an alternative to an authenticator app rather than as a
              switch with no opposite. */}
          <section className="glass-card pgpu-card prof-card">
            <div className="pgpu-head">
              <h3 className="pgpu-title"><Shield size={18} aria-hidden="true" /> PGP</h3>
              <span className={`pgpu-status${user?.has_pgp_key ? ' is-on' : ''}`}>
                <Key size={11} aria-hidden="true" />
                {user?.has_pgp_key ? 'Key on file' : 'No key yet'}
              </span>
            </div>

            <p className="pgpu-lede">
              Your public key lets the store prove you are you without a password, and encrypt
              things only you can read. Nothing here ever asks for your private key.
            </p>

            <div className="pgpu-keyblock">
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                onClick={() => setShowPgp(!showPgp)}
                aria-expanded={showPgp}
              >
                <Key size={13} aria-hidden="true" />
                {showPgp ? 'Cancel key change' : user?.has_pgp_key ? 'Replace key' : 'Add a key'}
              </button>

              {showPgp && (
                <div className="form-group" style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
                  <label htmlFor="pgp-key">PGP public key</label>
                  <textarea
                    id="pgp-key"
                    className="glass-input pgpu-key-input"
                    value={pgpKey}
                    onChange={(e) => setPgpKey(e.target.value)}
                    placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
                    rows={6}
                    spellCheck="false"
                  />
                  <p className="pgpu-hint">
                    Leave empty and save to remove your key. Removing it also turns off everything below.
                  </p>
                </div>
              )}
            </div>

            <div className="pgpu-options">
              <PgpOption
                id="pgp-login-only"
                icon={KeyRound}
                title="Sign in with my key instead of a password"
                hint="No password is asked for at all — decrypting the challenge is the whole sign-in."
                warning={
                  !user?.pgp_login_only && pgpLoginOnly
                    ? 'You will be asked to decrypt a test block before this is saved. If you cannot, it will not be enabled — which is the point.'
                    : null
                }
                checked={pgpLoginOnly}
                disabled={!user?.has_pgp_key}
                disabledNote="Add a key first."
                onChange={setPgpLoginOnly}
              />

              <PgpOption
                id="pgp-encrypt-address"
                icon={Lock}
                title="Encrypt my shipping address"
                hint="Your address is stored as a PGP block encrypted to the store's key and to yours, so it is not readable from the database — and you can still read your own orders."
                checked={pgpEncryptAddress}
                disabled={!user?.has_pgp_key || storeKey?.address_encryption_ready !== true}
                disabledNote={
                  !user?.has_pgp_key
                    ? 'Add a key first.'
                    // `!== true` rather than `=== false`: an install with no store
                    // key answers `{configured:false}`, and a request that failed
                    // answers nothing at all. Both mean this cannot take effect, and
                    // defaulting to "enabled" would let someone opt into a promise
                    // the store cannot keep.
                    : 'The store has no usable PGP key right now, so this cannot take effect.'
                }
                onChange={setPgpEncryptAddress}
              />
            </div>

            {pgpConfirm && (
              <div className="pgpu-confirm" role="group" aria-label="Confirm you hold this key">
                <p className="pgpu-confirm-lede">
                  <ShieldCheck size={13} aria-hidden="true" />
                  Decrypt this block with your private key and paste the token back, to confirm
                  you can still sign in once the password is switched off.
                </p>
                <textarea
                  className="glass-input pgpu-key-input"
                  value={pgpConfirm.challenge}
                  readOnly
                  rows={6}
                  aria-label="Confirmation challenge"
                  onFocus={(e) => e.target.select()}
                />
                <div className="form-group" style={{ margin: '0.6rem 0 0' }}>
                  <label htmlFor="pgp-confirm-token">Decrypted token</label>
                  <input
                    id="pgp-confirm-token"
                    className="glass-input prof-mono-input"
                    value={pgpConfirm.token}
                    onChange={(e) => setPgpConfirm((c) => ({ ...c, token: e.target.value }))}
                    placeholder="Paste the token from inside the block"
                    autoComplete="off"
                    spellCheck="false"
                  />
                </div>
                <div className="pgpu-confirm-actions">
                  <button
                    type="button"
                    className="glass-btn glass-btn-primary glass-btn-sm"
                    disabled={loading || !pgpConfirm.token.trim()}
                    onClick={() => updatePgp(pgpConfirm.token.trim())}
                  >
                    <Check size={13} aria-hidden="true" /> Confirm and save
                  </button>
                  <button
                    type="button"
                    className="glass-btn glass-btn-sm"
                    disabled={loading}
                    onClick={() => { setPgpConfirm(null); setPgpLoginOnly(user?.pgp_login_only || false); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {!pgpConfirm && (
              <button className="glass-btn glass-btn-primary" onClick={() => updatePgp()} disabled={loading}>
                {loading ? <span className="spinner spinner-inline" /> : <Save size={15} aria-hidden="true" />}
                Save PGP settings
              </button>
            )}
          </section>

          {/* ── What the AI may read ──
              Below the key and above the device list on purpose: it is a
              decision about this account's data, like the two cards above it,
              and not a preference like the rail's. Renders nothing at all on
              a shop that offers no buyer capability needing consent. */}
          <AiConsentSection />

          <SessionList />
        </div>

        {/* ── Reaching you ──────────────────────────────────────────── */}
        <aside className="prof-rail" ref={railRef}>
          <section className="glass-card prof-card">
            <div className="prof-card-head">
              <div className="prof-card-title">
                <h3><Link2 size={17} aria-hidden="true" /> Chat accounts</h3>
                <p>
                  Both bots are a full storefront, not just a notifier: browse, cart, check out
                  and manage orders from either one.
                </p>
              </div>
            </div>
            <div className="prof-channels">
              <BotChannel
                name="Telegram"
                icon={Send}
                linked={user?.telegram_linked}
                onLink={linkTelegram}
                onUnlink={unlinkTelegram}
                pending={telegramLink}
                deepLinkLabel="Open in Telegram"
              />
              <BotChannel
                name="Potato"
                icon={MessageCircle}
                linked={user?.potato_linked}
                onLink={linkPotato}
                onUnlink={unlinkPotato}
                pending={potatoLink}
                deepLinkLabel="Open in Potato"
              />
            </div>
          </section>

          <section className="glass-card prof-card">
            <div className="prof-card-head">
              <div className="prof-card-title">
                <h3><Bell size={17} aria-hidden="true" /> Notifications</h3>
                <p>These apply to every channel at once — browser push, the Telegram bot and the Potato bot.</p>
              </div>
            </div>

            <div className="prof-switches">
              <SwitchRow
                id="n-orders" title="Order updates"
                hint="When an order is paid, shipped, delivered or refunded."
                checked={notifyOrders}
                onChange={(v) => updateNotifyPrefs('notify_order_updates', v)}
              />
              <SwitchRow
                id="n-tickets" title="Support replies"
                hint="When staff answer one of your tickets."
                checked={notifyTicketReplies}
                onChange={(v) => updateNotifyPrefs('notify_ticket_replies', v)}
              />
              <SwitchRow
                id="n-products" title="New products"
                hint="When something new lands in the catalog."
                checked={notifyProducts}
                onChange={(v) => updateNotifyPrefs('notify_new_products', v)}
              />
              {/* Locked on for staff rather than hidden: the server alerts
                  every staff sign-in whatever the column says (the account
                  most worth alerting is the one an intruder would switch it
                  off on), and a switch drawn as off next to an alert that
                  arrives anyway would be the page lying. Buyers choose. */}
              <SwitchRow
                id="n-signins" title="Sign-in alerts"
                hint={isStaff
                  ? 'Always on for staff accounts. A new session opened as you is announced on every channel you have linked, and says nothing about the device or where it came from.'
                  : 'When a new session is opened on your account — a message on every channel you have linked, saying only that it happened and how it was proved. If it was not you, revoke the others from the devices list.'}
                checked={isStaff ? true : notifySignIns}
                disabled={!!isStaff}
                onChange={(v) => updateNotifyPrefs('notify_sign_ins', v)}
              />
              <SwitchRow
                id="n-push" title="Browser push"
                hint="Notifications from this browser, even with the tab closed. Needs the browser's own permission."
                checked={pushEnabled}
                onChange={togglePush}
              />
            </div>

            {/* The odd one out, and separated because of it: its siblings
                decide WHETHER you are pinged, this decides what is IN the
                ping — and the answer lives in a third party's cloud forever. */}
            <div className="prof-switch-danger">
              <SwitchRow
                id="n-bot-sensitive"
                title="Put the refund transaction ID in bot messages"
                hint="Off by default. When off, the bots still tell you when a refund is sent — they just leave out the transaction ID, which is a public chain record that names your receiving address. Turn it on only if you are comfortable with that sitting in your chat history, on every device that chat syncs to. Your delivery address and tracking numbers are never sent to a bot either way; they stay on this site."
                checked={botSensitive}
                onChange={(v) => updateNotifyPrefs('bot_sensitive_details', v)}
              />
            </div>

            {/* Not gated on browser push. It used to be, which meant a staff
                member who only ever used the Telegram or Potato bot could not
                reach the switches that decide what those bots send them —
                the categories apply to every channel, so the block belongs
                to every staff account. */}
            {isStaff && adminPrefs && (
              <div className="prof-staff-block">
                <h4 className="prof-subhead"><ShieldCheck size={13} aria-hidden="true" /> Staff alerts</h4>
                <div className="prof-switches">
                  <SwitchRow id="a-tickets" title="New tickets"
                    checked={adminPrefs.notify_new_tickets}
                    onChange={(v) => updateAdminPrefs('notify_new_tickets', v)} />
                  <SwitchRow id="a-replies" title="Ticket replies"
                    checked={adminPrefs.notify_ticket_replies}
                    onChange={(v) => updateAdminPrefs('notify_ticket_replies', v)} />
                  <SwitchRow id="a-orders" title="New orders"
                    checked={adminPrefs.notify_new_orders}
                    onChange={(v) => updateAdminPrefs('notify_new_orders', v)} />
                  <SwitchRow id="a-changes" title="Order status changes"
                    checked={adminPrefs.notify_order_changes}
                    onChange={(v) => updateAdminPrefs('notify_order_changes', v)} />
                  {/* Defaults on, like its four siblings — `?? true` rather than
                      a bare read so a staff member whose prefs row predates this
                      column sees the switch in the position the server is
                      actually treating them as being in. */}
                  <SwitchRow id="a-stock" title="Low stock alerts"
                    checked={adminPrefs.notify_low_stock ?? true}
                    onChange={(v) => updateAdminPrefs('notify_low_stock', v)} />
                </div>
                <div className="prof-switch-danger">
                  <SwitchRow
                    id="a-bot-details"
                    title="Put buyer, total and address in bot messages"
                    hint="Off by default. When off, staff alerts and the /o command still say what an order contains and what it needs, but leave out who placed it, what they paid and where it is going."
                    checked={adminPrefs.bot_staff_details ?? false}
                    onChange={(v) => updateAdminPrefs('bot_staff_details', v)}
                  />
                </div>
              </div>
            )}
          </section>

          {/* ── Your data ──
              Export everything the store holds on this account, signed by the
              store key when it can sign unattended; or erase the account —
              anonymise-and-detach, never delete, and refused while an order is
              in flight. Both are the account's own business and need no staff. */}
          <YourData />

          {/* ── Your companion ──
              Only renders when the operator both offers the assistant and has
              said people may pick their own animal. Same device-preference
              reasoning as the sounds switch below, and the card says so. */}
          <CompanionChoice />

          {/* ── Sounds ──
              A device preference, not an account row: stored in localStorage
              so it works before login, per machine, and leaves nothing about
              taste in the database. sounds.js reads the same key everywhere. */}
          <section className="glass-card prof-card">
            <div className="prof-card-head">
              <div className="prof-card-title">
                <h3><Volume2 size={17} aria-hidden="true" /> This device</h3>
              </div>
            </div>
            <SwitchRow
              id="sounds-toggle"
              title="Interface sounds"
              hint="Soft confirmations for adding to cart, orders, payment landing and new chat messages — synthesized on your device, nothing downloaded. This switch only affects this browser."
              checked={!soundsOff}
              onChange={(on) => {
                setSoundsMuted(!on);
                setSoundsOff(!on);
                // Play the sample AFTER unmuting, so switching on is audible
                // proof rather than a promise.
                if (on) playSound('notify');
              }}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}
