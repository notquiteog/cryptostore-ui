import ProgressBar from '../../components/ProgressBar';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import {
  KeyRound, ShieldCheck, ShieldOff, ShieldAlert, Fingerprint, Sparkles, Plus, Upload, Copy,
  Download, Trash2, Ban, CheckCircle2, AlertTriangle, Lock, Unlock, PenLine,
  RefreshCw, X, Clock, Eye, EyeOff, Check, Radio, Search, User,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import NextStops from '../../components/admin/NextStops';

/**
 * The store's PGP identity.
 *
 * The page is built around one question an operator should be able to answer
 * from the doorway: *which key is the store signing as right now*. That is the
 * hero panel, and everything else — the forge, the archive, the signing desk —
 * is subordinate to it. A store with no key gets the same panel in a dormant
 * state rather than an empty list, because "you have not done this yet" is the
 * most useful thing the screen can say at that moment.
 */

/* ── Fingerprint helpers ─────────────────────────────────────────────────── */

/** Fingerprints are read aloud and compared in fours. Render them that way. */
function fingerprintGroups(fingerprint) {
  return String(fingerprint || '').toUpperCase().match(/.{1,4}/g) || [];
}

/**
 * A colour per fingerprint group.
 *
 * Comparing forty hex characters by eye is something nobody actually does —
 * they check the first four, the last four, and move on. A colour bar derived
 * from the whole string is compared in one glance instead, and a key that
 * differs anywhere in the middle looks obviously different. Same idea as
 * OpenSSH's randomart, minus the ASCII.
 *
 * Lightness is fixed high enough to stay legible on the light theme's ground
 * and saturated enough to stay distinct on the dark one.
 */
function groupHue(group) {
  return parseInt(group, 16) % 360;
}

/* ── Formatting ──────────────────────────────────────────────────────────── */

const DAY_MS = 86400000;

/** "in 2 years" / "in 27 days" / "5 days ago". Coarse on purpose. */
function relativeDays(value) {
  if (!value) return null;
  const diff = new Date(value).getTime() - Date.now();
  const days = Math.round(Math.abs(diff) / DAY_MS);
  const span = days >= 730 ? `${Math.round(days / 365)} years`
    : days >= 60 ? `${Math.round(days / 30)} months`
      : days === 1 ? '1 day' : `${days} days`;
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}

function shortDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** openpgp reports raw algorithm names; these are what people call them. */
const ALGORITHM_LABELS = {
  ed25519: 'Curve25519 · EdDSA',
  eddsaLegacy: 'Curve25519 · EdDSA',
  ecdsa: 'ECDSA',
  rsaEncryptSign: 'RSA',
  rsaSign: 'RSA',
};

function algorithmLabel(key) {
  const base = ALGORITHM_LABELS[key.algorithm] || key.algorithm;
  if (key.bits) return `${base} ${key.bits}`;
  if (key.curve) return `${base} · ${key.curve}`;
  return base;
}

/**
 * The single status a key is in, in precedence order. Revocation outranks
 * expiry outranks publication: a revoked key that also happens to be expired is
 * a revoked key, and saying "expired" would understate it.
 */
function keyStatus(key) {
  if (key.revoked_at) return { tone: 'revoked', label: 'Revoked', Icon: ShieldOff };
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return { tone: 'expired', label: 'Expired', Icon: Clock };
  }
  if (key.active) return { tone: 'live', label: 'Published', Icon: ShieldCheck };
  return { tone: 'idle', label: 'Stored', Icon: KeyRound };
}

/* ── Small pieces ────────────────────────────────────────────────────────── */

function Fingerprints({ fingerprint, size = 'md' }) {
  const groups = fingerprintGroups(fingerprint);
  return (
    <div className={`pgp-fp pgp-fp-${size}`} title={fingerprint}>
      {groups.map((group, i) => (
        <span key={i} className="pgp-fp-group" style={{ '--pgp-i': i, '--pgp-hue': groupHue(group) }}>
          {group}
        </span>
      ))}
    </div>
  );
}

/** The colour bar. Decorative, so it is hidden from assistive tech. */
function FingerprintBars({ fingerprint }) {
  const groups = fingerprintGroups(fingerprint);
  return (
    <div className="pgp-fp-bars" aria-hidden="true">
      {groups.map((group, i) => (
        <i key={i} style={{ '--pgp-i': i, '--pgp-hue': groupHue(group) }} />
      ))}
    </div>
  );
}

function StatusPill({ status }) {
  const { tone, label, Icon } = status;
  return (
    <span className={`pgp-pill pgp-pill-${tone}`}>
      <Icon size={13} aria-hidden="true" />
      {label}
    </span>
  );
}

function CopyButton({ value, label = 'Copy', className = 'glass-btn glass-btn-sm', title }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      toast.error('Clipboard blocked by the browser');
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" className={className} onClick={copy} title={title || label}>
      {copied ? <Check size={14} className="pgp-copied" /> : <Copy size={14} />}
      {label ? <span>{copied ? 'Copied' : label}</span> : null}
    </button>
  );
}

function downloadArmor(filename, contents) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/pgp-keys' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoked on the next frame rather than immediately: Firefox cancels an
  // in-flight download if the object URL dies in the same tick as the click.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}

/* ── The hero ────────────────────────────────────────────────────────────── */

/**
 * The medallion. Rings, aura and a key glyph, in one of four tones.
 *
 * Pulled out of the hero because the empty state uses it too — a dormant
 * medallion reads as "this is where the key will be" far better than an icon
 * in a grey box.
 */
function KeyMedallion({ tone, Icon = KeyRound, spinning = false }) {
  return (
    <div className={`pgp-medallion pgp-medallion-${tone}${spinning ? ' is-forging' : ''}`}>
      <span className="pgp-medallion-aura" aria-hidden="true" />
      <span className="pgp-medallion-ring pgp-medallion-ring-1" aria-hidden="true" />
      <span className="pgp-medallion-ring pgp-medallion-ring-2" aria-hidden="true" />
      <span className="pgp-medallion-core">
        <Icon size={30} aria-hidden="true" />
      </span>
    </div>
  );
}

function ActiveKeyHero({ activeKey, canExportPrivate, onUnpublish, onRevoke, onExport, busy }) {
  const status = keyStatus(activeKey);
  const expiry = relativeDays(activeKey.expires_at);

  return (
    <section className="glass-card pgp-hero">
      <span className="pgp-hero-wash" aria-hidden="true" />

      <div className="pgp-hero-top">
        <KeyMedallion tone={status.tone} Icon={status.Icon} />

        <div className="pgp-hero-ident">
          <div className="pgp-hero-kicker">
            <StatusPill status={status} />
            <span className="pgp-chip">{algorithmLabel(activeKey)}</span>
            {activeKey.passphrase_protected ? (
              <span className="pgp-chip pgp-chip-lock"><Lock size={12} /> Passphrase</span>
            ) : (
              <span className="pgp-chip"><Unlock size={12} /> Unattended</span>
            )}
            {!activeKey.can_sign && <span className="pgp-chip pgp-chip-warn">Public half only</span>}
          </div>

          <h2 className="pgp-hero-title">
            {activeKey.user_ids[0] || activeKey.label || 'Store key'}
          </h2>
          {activeKey.user_ids.length > 1 && (
            <p className="pgp-hero-alt">
              also {activeKey.user_ids.slice(1).join(', ')}
            </p>
          )}
        </div>
      </div>

      <div className="pgp-hero-fp">
        <div className="pgp-hero-fp-head">
          <Fingerprint size={14} aria-hidden="true" />
          <span>Fingerprint</span>
          <CopyButton value={activeKey.fingerprint} label="" className="pgp-icon-btn" title="Copy fingerprint" />
        </div>
        <Fingerprints fingerprint={activeKey.fingerprint} size="lg" />
        <FingerprintBars fingerprint={activeKey.fingerprint} />
      </div>

      <dl className="pgp-hero-facts">
        <div><dt>Key ID</dt><dd className="pgp-mono">{activeKey.key_id}</dd></div>
        <div><dt>Created</dt><dd>{shortDate(activeKey.created_at)}</dd></div>
        <div>
          <dt>Expires</dt>
          <dd>{activeKey.expires_at ? <>{shortDate(activeKey.expires_at)} <span className="pgp-dim">({expiry})</span></> : 'Never'}</dd>
        </div>
        {activeKey.revoked_at && (
          <div><dt>Revoked</dt><dd className="pgp-danger-text">{shortDate(activeKey.revoked_at)}</dd></div>
        )}
      </dl>

      <div className="pgp-hero-actions">
        <CopyButton value={activeKey.public_key} label="Copy public key" className="glass-btn glass-btn-primary" />
        <button
          className="glass-btn"
          onClick={() => downloadArmor(`store-pgp-${activeKey.key_id}.asc`, activeKey.public_key)}
        >
          <Download size={16} /> Download
        </button>
        {canExportPrivate && activeKey.can_sign && (
          <button className="glass-btn" onClick={() => onExport(activeKey, 'private')}>
            <Eye size={16} /> Export private key
          </button>
        )}
        {activeKey.active && (
          <button className="glass-btn" onClick={() => onUnpublish(activeKey)} disabled={busy}>
            <Radio size={16} /> Unpublish
          </button>
        )}
        {!activeKey.revoked_at && (
          <button className="glass-btn glass-btn-danger" onClick={() => onRevoke(activeKey)} disabled={busy}>
            <Ban size={16} /> Revoke
          </button>
        )}
      </div>
    </section>
  );
}

function EmptyHero({ onGenerate, onImport }) {
  return (
    <section className="glass-card pgp-hero pgp-hero-empty">
      <span className="pgp-hero-wash" aria-hidden="true" />
      <KeyMedallion tone="idle" Icon={KeyRound} />
      <h2 className="pgp-hero-title">No key published</h2>
      <p className="pgp-empty-copy">
        A store key lets customers verify that a payment address, a canary or an
        announcement really came from you — and not from a copy of your site.
        Generate one, or import the key you already publish elsewhere.
      </p>
      <div className="pgp-hero-actions pgp-hero-actions-center">
        <button className="glass-btn glass-btn-primary" onClick={onGenerate}>
          <Sparkles size={16} /> Generate a key
        </button>
        <button className="glass-btn" onClick={onImport}>
          <Upload size={16} /> Import existing
        </button>
      </div>
    </section>
  );
}

/* ── The forge ───────────────────────────────────────────────────────────── */

const FORGE_LINES = [
  'Gathering entropy',
  'Deriving the primary key',
  'Binding the signing subkey',
  'Self-signing the user ID',
  'Writing the revocation certificate',
];

/** The overlay shown while a keypair is being made. */
function ForgeProgress({ label }) {
  const [line, setLine] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setLine((n) => (n + 1) % FORGE_LINES.length), 620);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="pgp-forge" role="status" aria-live="polite">
      <KeyMedallion tone="forge" Icon={Sparkles} spinning />
      <div className="pgp-forge-text">
        <div className="pgp-forge-title">{label}</div>
        <div className="pgp-forge-line" key={line}>{FORGE_LINES[line]}…</div>
      </div>
      <div className="pgp-forge-bar" aria-hidden="true"><i /></div>
    </div>
  );
}

const BLANK_FORM = {
  name: '', email: '', comment: '', label: '',
  key_type: 'curve25519', expires_days: '730', passphrase: '', activate: true,
};

function GeneratePanel({ keyTypes, onDone, onCancel }) {
  const [form, setForm] = useState(BLANK_FORM);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [generating, setGenerating] = useState(false);

  const set = (field) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('A name is required');

    setGenerating(true);
    // Curve25519 lands in well under a frame, which makes the forge panel
    // flash rather than play. A floor keeps the feedback legible without
    // holding up the RSA path, which takes longer than this anyway.
    const floor = new Promise((resolve) => setTimeout(resolve, 900));
    try {
      const [{ key }] = await Promise.all([
        api.post('/store-pgp/keys/generate', {
          ...form,
          expires_days: Number(form.expires_days) || 0,
        }),
        floor,
      ]);
      toast.success('Key generated');
      onDone(key);
      setForm(BLANK_FORM);
    } catch (err) {
      toast.error(err.message);
    }
    setGenerating(false);
  };

  return (
    <form className="glass-card admin-panel-in pgp-panel" onSubmit={submit}>
      <div className="pgp-panel-head">
        <h3 className="admin-card-title"><Sparkles size={16} /> Generate a key</h3>
        <button type="button" className="pgp-icon-btn" onClick={onCancel} aria-label="Close"><X size={16} /></button>
      </div>

      {generating && <ForgeProgress label="Forging keypair" />}

      <fieldset className="pgp-fieldset" disabled={generating}>
        <div className="pgp-algos" role="radiogroup" aria-label="Algorithm">
          {keyTypes.map((type) => (
            <label
              key={type.key}
              className={`pgp-algo${form.key_type === type.key ? ' is-selected' : ''}`}
            >
              <input
                type="radio"
                name="key_type"
                value={type.key}
                checked={form.key_type === type.key}
                onChange={set('key_type')}
              />
              <span className="pgp-algo-name">{type.label}</span>
              <span className="pgp-algo-check"><Check size={12} /></span>
            </label>
          ))}
        </div>

        <div className="admin-form-grid">
          <div className="form-group">
            <label>Name<span className="pgp-req">*</span></label>
            <input className="glass-input" value={form.name} onChange={set('name')} placeholder="CryptoStore" />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input className="glass-input" type="email" value={form.email} onChange={set('email')} placeholder="support@example.com" />
          </div>
          <div className="form-group">
            <label>Comment</label>
            <input className="glass-input" value={form.comment} onChange={set('comment')} placeholder="Signing key" />
          </div>
          <div className="form-group">
            <label>Internal label</label>
            <input className="glass-input" value={form.label} onChange={set('label')} placeholder="Primary 2026" />
          </div>
          <div className="form-group">
            <label>Expires in (days)</label>
            <input className="glass-input" type="number" min="0" value={form.expires_days} onChange={set('expires_days')} placeholder="0 = never" />
          </div>
          <div className="form-group">
            <label>Passphrase</label>
            <div className="pgp-input-wrap">
              <input
                className="glass-input"
                type={showPassphrase ? 'text' : 'password'}
                value={form.passphrase}
                onChange={set('passphrase')}
                placeholder="Optional"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="pgp-icon-btn pgp-input-btn"
                onClick={() => setShowPassphrase((v) => !v)}
                aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showPassphrase ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        </div>

        <p className="pgp-note">
          {form.passphrase
            ? <><Lock size={13} /> The private key is encrypted at rest. Every signature will ask for this passphrase — the store cannot sign on its own.</>
            : <><Unlock size={13} /> The private key is stored unencrypted so the store can sign unattended. Anyone who reads the database can sign as you.</>}
        </p>

        <label className="admin-form-check pgp-check">
          <input type="checkbox" checked={form.activate} onChange={set('activate')} />
          <span>Publish immediately — replaces whichever key is currently published</span>
        </label>

        <div className="admin-form-actions">
          <button className="glass-btn glass-btn-primary" type="submit" disabled={generating}>
            {generating ? <><span className="spinner spinner-inline" /> Generating…</> : <><Sparkles size={16} /> Generate</>}
          </button>
          <button className="glass-btn" type="button" onClick={onCancel} disabled={generating}>Cancel</button>
        </div>
      </fieldset>
    </form>
  );
}

function ImportPanel({ onDone, onCancel }) {
  const [armored, setArmored] = useState('');
  const [label, setLabel] = useState('');
  const [activate, setActivate] = useState(true);
  const [busy, setBusy] = useState(false);

  const isPrivate = armored.includes('PRIVATE KEY BLOCK');

  const submit = async (e) => {
    e.preventDefault();
    if (!armored.trim()) return toast.error('Paste an armored key block');
    setBusy(true);
    try {
      const { key } = await api.post('/store-pgp/keys/import', { armored_key: armored, label, activate });
      toast.success('Key imported');
      onDone(key);
      setArmored('');
      setLabel('');
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  return (
    <form className="glass-card admin-panel-in pgp-panel" onSubmit={submit}>
      <div className="pgp-panel-head">
        <h3 className="admin-card-title"><Upload size={16} /> Import a key</h3>
        <button type="button" className="pgp-icon-btn" onClick={onCancel} aria-label="Close"><X size={16} /></button>
      </div>

      <p className="admin-hint">
        Paste either half. A public block lets the store publish and verify;
        a private block also lets it sign.
      </p>

      <div className="form-group">
        <label>Armored key block</label>
        <textarea
          className="glass-input pgp-armor-input"
          rows={9}
          spellCheck={false}
          value={armored}
          onChange={(e) => setArmored(e.target.value)}
          placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
        />
      </div>

      {armored.trim() && (
        <p className="pgp-note">
          {isPrivate
            ? <><Lock size={13} /> Private key detected — this key will be able to sign.</>
            : <><Fingerprint size={13} /> Public key detected — publish and verify only, no signing.</>}
        </p>
      )}

      <div className="form-group">
        <label>Internal label</label>
        <input className="glass-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Offline master" />
      </div>

      <label className="admin-form-check pgp-check">
        <input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} />
        <span>Publish immediately</span>
      </label>

      <div className="admin-form-actions">
        <button className="glass-btn glass-btn-primary" type="submit" disabled={busy}>
          {busy ? <><span className="spinner spinner-inline" /> Importing…</> : <><Upload size={16} /> Import</>}
        </button>
        <button className="glass-btn" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

/* ── Signing desk ────────────────────────────────────────────────────────── */

function SignPanel({ signingKeys }) {
  const [keyId, setKeyId] = useState(() => (signingKeys.find((k) => k.active) || signingKeys[0])?.id);
  const [message, setMessage] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [signed, setSigned] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = signingKeys.find((k) => String(k.id) === String(keyId)) || signingKeys[0];

  // The nominated key can disappear underneath this panel — revoked, deleted,
  // or unpublished from the archive below. Fall back rather than sign with a
  // stale id the server would reject.
  useEffect(() => {
    if (!signingKeys.some((k) => String(k.id) === String(keyId))) {
      setKeyId((signingKeys.find((k) => k.active) || signingKeys[0])?.id);
    }
  }, [signingKeys, keyId]);

  const sign = async (e) => {
    e.preventDefault();
    if (!message.trim()) return toast.error('Nothing to sign');
    setBusy(true);
    try {
      const data = await api.post(`/store-pgp/keys/${selected.id}/sign`, { message, passphrase });
      setSigned(data.signed);
      setPassphrase('');
      toast.success('Signed');
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  if (!selected) return null;

  return (
    <section className="glass-card pgp-panel pgp-sign">
      <h3 className="admin-card-title"><PenLine size={16} /> Sign a message</h3>
      <p className="admin-hint">
        Produces a cleartext signed block. Paste it wherever the customer will
        read it — they verify it against the fingerprint above.
      </p>

      <form onSubmit={sign}>
        <div className="admin-form-grid">
          <div className="form-group">
            <label>Sign with</label>
            <select className="glass-input" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
              {signingKeys.map((k) => (
                <option key={k.id} value={k.id}>
                  {(k.user_ids[0] || k.label || k.key_id)}{k.active ? ' — published' : ''}
                </option>
              ))}
            </select>
          </div>
          {selected.passphrase_protected && (
            <div className="form-group">
              <label>Passphrase</label>
              <input
                className="glass-input"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          )}
        </div>

        <div className="form-group">
          <label>Message</label>
          <textarea
            className="glass-input pgp-armor-input"
            rows={5}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Our only Bitcoin address is bc1q…"
          />
        </div>

        <div className="admin-form-actions">
          <button className="glass-btn glass-btn-primary" type="submit" disabled={busy}>
            {busy ? <><span className="spinner spinner-inline" /> Signing…</> : <><PenLine size={16} /> Sign</>}
          </button>
          {signed && <button className="glass-btn" type="button" onClick={() => setSigned('')}>Clear</button>}
        </div>
      </form>

      {signed && (
        <div className="pgp-output admin-panel-in">
          <div className="pgp-output-head">
            <span><CheckCircle2 size={14} /> Signed block</span>
            <CopyButton value={signed} label="Copy" />
          </div>
          <pre className="pgp-armor">{signed}</pre>
        </div>
      )}
    </section>
  );
}

/* ── Verify desk ─────────────────────────────────────────────────────────── */

/**
 * The verdicts the server can return, and how loud each one is.
 *
 * `good_key_revoked` is painted as an alarm rather than a pass on purpose. The
 * signature is mathematically fine, but a revoked key is one its owner told
 * the world to stop trusting — the message may have been made by whoever
 * walked off with it. `unknown_key` is a warning, not a failure: the message
 * may be perfectly genuine and simply signed by somebody other than the keys
 * that were checked, and the panel says which key id to go and find.
 */
const VERDICTS = {
  good:             { tone: 'good', Icon: ShieldCheck, title: 'Good signature' },
  good_key_expired: { tone: 'warn', Icon: Clock,       title: 'Good signature — the key has since expired' },
  good_key_revoked: { tone: 'bad',  Icon: ShieldOff,   title: 'Good signature from a key that is now revoked' },
  unknown_key:      { tone: 'warn', Icon: KeyRound,    title: 'Signed by a key that was not among those checked' },
  bad:              { tone: 'bad',  Icon: ShieldAlert, title: 'Bad signature — the text is not what was signed' },
};

const SOURCE_LABEL = { store: 'store key', user: "customer's key", pasted: 'pasted key' };

/**
 * The other half of the desk: a signed block in, a verdict and the signing key
 * out.
 *
 * Three questions an operator brings here, and the "check against" row is
 * the question: was this notice really signed by the store (any key it has
 * ever held, so last year's post still checks); did this customer really sign
 * this refund address (the key on their account, by username); does this
 * block check against a key somebody sent me. The verification runs on the
 * server, which already holds every key involved, and nothing about it is
 * logged.
 *
 * The signed TEXT is shown back under the verdict, not just a tick, because a
 * signature covers exactly the bytes it covers: the classic trick is a good
 * signature over one address pasted above a different one.
 */
function VerifyPanel({ hasStoreKeys }) {
  const [against, setAgainst] = useState(hasStoreKeys ? 'store' : 'key');
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');
  const [armoredKey, setArmoredKey] = useState('');
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);

  const verify = async (e) => {
    e.preventDefault();
    if (!message.trim()) return toast.error('Paste the signed message first');
    if (against === 'user' && !username.trim()) return toast.error('Enter the customer’s username');
    if (against === 'key' && !armoredKey.trim()) return toast.error('Paste the public key to check against');
    setBusy(true);
    setVerdict(null);
    try {
      const data = await api.post('/store-pgp/verify', {
        message,
        against,
        username: against === 'user' ? username.trim() : undefined,
        armored_key: against === 'key' ? armoredKey : undefined,
      });
      setVerdict(data);
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  const v = verdict ? (VERDICTS[verdict.status] || VERDICTS.bad) : null;
  const signer = verdict?.signer;

  const choices = [
    { key: 'store', label: 'The store’s keys', hint: hasStoreKeys ? 'every key ever held here' : 'no key stored yet', disabled: !hasStoreKeys },
    { key: 'user', label: 'A customer’s key', hint: 'the key on their account' },
    { key: 'key', label: 'A pasted key', hint: 'any public key block' },
  ];

  return (
    <section className="glass-card pgp-panel pgp-verify" id="pgp-verify" data-search-target="pgp-verify">
      <h3 className="admin-card-title"><Search size={16} /> Verify a message</h3>
      <p className="admin-hint">
        Paste a cleartext-signed block and it is checked against the keys you choose. The verdict
        names the key, and shows the exact text the signature covers.
      </p>

      <form onSubmit={verify}>
        {/* The same radio-tile pattern as the algorithm picker in the forge —
            one class family, so a new tile style is not a new tile style. */}
        <div className="pgp-algos pgp-against" role="radiogroup" aria-label="Check against">
          {choices.map((c) => (
            <label
              key={c.key}
              className={`pgp-algo${against === c.key ? ' is-selected' : ''}${c.disabled ? ' is-disabled' : ''}`}
              title={c.hint}
            >
              <input
                type="radio"
                name="pgp-against"
                value={c.key}
                checked={against === c.key}
                disabled={c.disabled}
                onChange={() => { setAgainst(c.key); setVerdict(null); }}
              />
              <span className="pgp-algo-name">
                {c.label}
                <small className="pgp-against-hint">{c.hint}</small>
              </span>
              <span className="pgp-algo-check"><Check size={12} /></span>
            </label>
          ))}
        </div>

        {against === 'user' && (
          <div className="form-group">
            <label>Username</label>
            <div className="pgp-input-wrap">
              <input
                className="glass-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="the account whose key should have signed this"
                autoComplete="off"
                spellCheck={false}
              />
              <User size={15} className="pgp-input-glyph" aria-hidden="true" />
            </div>
          </div>
        )}
        {against === 'key' && (
          <div className="form-group">
            <label>Public key</label>
            <textarea
              className="glass-input pgp-armor-input"
              rows={5}
              spellCheck={false}
              value={armoredKey}
              onChange={(e) => setArmoredKey(e.target.value)}
              placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
            />
          </div>
        )}

        <div className="form-group">
          <label>Signed message</label>
          <textarea
            className="glass-input pgp-armor-input"
            rows={7}
            spellCheck={false}
            value={message}
            onChange={(e) => { setMessage(e.target.value); if (verdict) setVerdict(null); }}
            placeholder="-----BEGIN PGP SIGNED MESSAGE-----"
          />
        </div>

        <div className="admin-form-actions">
          <button className="glass-btn glass-btn-primary" type="submit" disabled={busy}>
            {busy ? <><span className="spinner spinner-inline" /> Checking…</> : <><Search size={16} /> Verify</>}
          </button>
          {(message || verdict) && (
            <button className="glass-btn" type="button" onClick={() => { setMessage(''); setVerdict(null); }}>Clear</button>
          )}
        </div>
      </form>

      {verdict && v && (
        <div className={`pgp-verdict pgp-verdict-${v.tone} admin-panel-in`} role="status" aria-live="polite">
          <div className="pgp-verdict-head">
            <v.Icon size={20} aria-hidden="true" />
            <strong>{v.title}</strong>
          </div>

          {signer && (
            <dl className="pgp-verdict-facts">
              <div>
                <dt>Signed by</dt>
                <dd>
                  {signer.user_ids?.[0] || signer.label || signer.key_id}
                  <span className="pgp-chip">{SOURCE_LABEL[signer.source] || signer.source}</span>
                  {signer.source === 'store' && signer.label && signer.user_ids?.[0] && (
                    <span className="pgp-dim"> · {signer.label}</span>
                  )}
                  {signer.source === 'store' && signer.active && <span className="pgp-pill pgp-pill-live"><ShieldCheck size={12} /> Published</span>}
                  {signer.source === 'store' && !signer.active && !signer.revoked_at && <span className="pgp-pill">Archived</span>}
                </dd>
              </div>
              <div>
                <dt>Key</dt>
                <dd><Fingerprints fingerprint={signer.fingerprint} size="sm" /></dd>
              </div>
              <div>
                <dt>Signed</dt>
                <dd>{verdict.signed_at ? new Date(verdict.signed_at).toLocaleString() : 'no timestamp in the signature'}</dd>
              </div>
              {(signer.key_revoked || signer.revoked_at) && (
                <div><dt>Revoked</dt><dd className="pgp-danger-text">{signer.revoked_at ? shortDate(signer.revoked_at) : 'yes — the key carries a revocation'}</dd></div>
              )}
              {signer.key_expires_at && (
                <div><dt>Key expires</dt><dd>{shortDate(signer.key_expires_at)} <span className="pgp-dim">({relativeDays(signer.key_expires_at)})</span></dd></div>
              )}
            </dl>
          )}

          {verdict.status === 'unknown_key' && (
            <p className="pgp-verdict-note">
              The signature names key ID{verdict.key_ids?.length === 1 ? '' : 's'}{' '}
              <span className="pgp-mono">{(verdict.key_ids || []).join(', ')}</span>, which{' '}
              {against === 'store' ? 'the store has never held' : against === 'user' ? 'is not the key on that account' : 'is not the key you pasted'}.
              Find that key and check against it as a pasted key — the message may be genuine and simply not from here.
            </p>
          )}
          {verdict.status === 'bad' && (
            <p className="pgp-verdict-note">
              The key matches but the digest does not: the text was edited after signing, or the signature was
              lifted from another message. Do not act on it. {verdict.reason ? <span className="pgp-dim">({verdict.reason})</span> : null}
            </p>
          )}
          {verdict.status === 'good_key_revoked' && (
            <p className="pgp-verdict-note">
              The signature checks against the key as it was when this was signed, but the key has since been
              revoked. Treat this as unverified unless you know it was made before the revocation.
            </p>
          )}

          {verdict.text != null && (
            <div className="pgp-output">
              <div className="pgp-output-head pgp-verdict-text-head">
                <span><CheckCircle2 size={14} /> What the signature covers</span>
                <CopyButton value={verdict.text} label="Copy" />
              </div>
              <pre className="pgp-armor pgp-verdict-text">{verdict.text}</pre>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ── Decrypt desk ────────────────────────────────────────────────────────── */

/**
 * Read a block that was encrypted to the store key.
 *
 * The server matches the block to whichever stored key it was encrypted for
 * — the published one or an archived one — and unlocks that. Every attempt,
 * successful or not, is written to the audit log with the key's fingerprint
 * and never with the text, which is why the panel says so before the button
 * is pressed: the operator should know they are leaving a record.
 *
 * The plaintext is shown, copied, and then CLEARED on purpose. What arrives
 * here is very often a shipping address, and an address left on a screen is
 * an address in the next screenshot.
 */
function DecryptPanel({ keys }) {
  const [message, setMessage] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  // Only known after the server has matched the block to a key; until then
  // the field is offered whenever any decryptable key would need one.
  const anyProtected = keys.some((k) => k.can_sign && k.passphrase_protected);

  const decrypt = async (e) => {
    e.preventDefault();
    if (!message.trim()) return toast.error('Paste the encrypted message first');
    setBusy(true);
    setResult(null);
    try {
      const data = await api.post('/store-pgp/decrypt', { message, passphrase: passphrase || undefined });
      setResult(data);
      setPassphrase('');
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  const clear = () => { setMessage(''); setResult(null); setPassphrase(''); };

  return (
    <section className="glass-card pgp-panel pgp-decrypt" id="pgp-decrypt" data-search-target="pgp-decrypt">
      <h3 className="admin-card-title"><Unlock size={16} /> Decrypt a message</h3>
      <p className="admin-hint">
        A block encrypted to the store key — an address a buyer sealed themselves, a message from a
        customer — opened with whichever store key it was encrypted for. Every attempt is recorded in
        the audit log, by key and outcome; the text itself is never written anywhere.
      </p>

      <form onSubmit={decrypt}>
        <div className="form-group">
          <label>Encrypted message</label>
          <textarea
            className="glass-input pgp-armor-input"
            rows={7}
            spellCheck={false}
            value={message}
            onChange={(e) => { setMessage(e.target.value); if (result) setResult(null); }}
            placeholder="-----BEGIN PGP MESSAGE-----"
          />
        </div>

        {anyProtected && (
          <div className="form-group">
            <label>Passphrase</label>
            <div className="pgp-input-wrap">
              <input
                className="glass-input"
                type={showPassphrase ? 'text' : 'password'}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Needed when the matching key is passphrase-protected"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="pgp-icon-btn pgp-input-btn"
                onClick={() => setShowPassphrase((v) => !v)}
                aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
              >
                {showPassphrase ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        )}

        <div className="admin-form-actions">
          <button className="glass-btn glass-btn-primary" type="submit" disabled={busy}>
            {busy ? <><span className="spinner spinner-inline" /> Decrypting…</> : <><Unlock size={16} /> Decrypt</>}
          </button>
          {(message || result) && (
            <button className="glass-btn" type="button" onClick={clear}>Clear</button>
          )}
        </div>
      </form>

      {result && (
        <div className="pgp-output admin-panel-in">
          <div className="pgp-output-head">
            <span>
              <CheckCircle2 size={14} /> Decrypted with{' '}
              <span className="pgp-mono">{result.key?.key_id}</span>
              {result.key?.label ? <span className="pgp-dim"> · {result.key.label}</span> : null}
              {result.key && !result.key.active && <span className="pgp-chip">archived key</span>}
              {result.recipients > 1 && (
                <span className="pgp-dim"> · {result.recipients} recipients could open it</span>
              )}
            </span>
            <CopyButton value={result.text} label="Copy" />
          </div>
          <pre className="pgp-armor pgp-verdict-text pgp-plaintext">{result.text}</pre>
          <p className="pgp-note">
            <Lock size={13} /> This read is in the audit log. Clear it once you have what you need —
            what is on this screen is usually somebody's address.
          </p>
        </div>
      )}
    </section>
  );
}

/* ── Archive ─────────────────────────────────────────────────────────────── */

/**
 * DESIGN §6, answered for the archive: **a toggle**.
 *
 * Not the responsive table. A KeyCard is not a row of cells with `data-label`
 * on them — it carries a grouped fingerprint, a derived colour bar, a status
 * pill, two material chips and up to six actions, and the colour bar in
 * particular is a picture, not a value. Not two silently-chosen views either,
 * because both readings are real and neither is "the phone one": inspecting a
 * single key before publishing it wants the card, and auditing a rotation —
 * which of twenty keys is live, which expired last month, which still holds a
 * private half — wants twenty lines, not twenty tall cards and a scrollbar.
 *
 * So the operator picks and `useViewMode` remembers. The row below keeps every
 * field the card prints: the fingerprint truncates rather than disappearing,
 * with the full value on hover and the colour bar — derived from the whole
 * string — underneath it.
 */

/** The archive's actions, as glyphs. Same set, same order, in both views. */
function KeyActions({ item, canExportPrivate, onActivate, onDeactivate, onRevoke, onDelete, onExport, busy, compact }) {
  const cls = compact ? 'pgp-icon-btn' : 'glass-btn glass-btn-sm';
  const danger = compact ? 'pgp-icon-btn pgp-icon-btn-danger' : 'glass-btn glass-btn-sm glass-btn-danger';
  const word = (text) => (compact ? null : text);

  return (
    <>
      <CopyButton value={item.public_key} label={compact ? '' : 'Public key'} className={cls} title="Copy public key" />
      {canExportPrivate && item.can_sign && (
        <button className={cls} onClick={() => onExport(item, 'private')} title="Export private key" aria-label="Export private key">
          <Eye size={14} aria-hidden="true" />{word('Private')}
        </button>
      )}
      {item.has_revocation_certificate && canExportPrivate && (
        <button className={cls} onClick={() => onExport(item, 'revocation')} title="Export revocation certificate" aria-label="Export revocation certificate">
          <ShieldOff size={14} aria-hidden="true" />{word('Revocation cert')}
        </button>
      )}
      {!item.active && !item.revoked_at && (
        <button
          className={compact ? cls : 'glass-btn glass-btn-sm glass-btn-success'}
          onClick={() => onActivate(item)}
          disabled={busy}
          title="Publish this key"
          aria-label="Publish this key"
        >
          <Radio size={14} aria-hidden="true" />{word('Publish')}
        </button>
      )}
      {item.active && (
        <button className={cls} onClick={() => onDeactivate(item)} disabled={busy} title="Unpublish this key" aria-label="Unpublish this key">
          <Radio size={14} aria-hidden="true" />{word('Unpublish')}
        </button>
      )}
      {!item.revoked_at && (
        <button className={danger} onClick={() => onRevoke(item)} disabled={busy} title="Revoke this key" aria-label="Revoke this key">
          <Ban size={14} aria-hidden="true" />{word('Revoke')}
        </button>
      )}
      {!item.active && (
        <button className={danger} onClick={() => onDelete(item)} disabled={busy} title="Delete this key" aria-label="Delete this key">
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
    </>
  );
}

function KeyRow({ item, canExportPrivate, ...actions }) {
  const status = keyStatus(item);
  // Urgent means somebody has to act, not "this key is old". A revoked or
  // expired key sitting in the archive is history and stays plain; the same
  // key still PUBLISHED is the store handing customers something they should
  // not trust, which is the one state on this page worth an alarm.
  const misPublished = item.active && (status.tone === 'revoked' || status.tone === 'expired');

  return (
    <div className={`lrow pgp-lrow-${status.tone}${misPublished ? ' is-urgent' : ''}`}>
      <div className="lrow-stack">
        <span className="lrow-text" title={item.user_ids.join(', ') || item.label || item.key_id}>
          {item.user_ids[0] || item.label || item.key_id}
          {item.passphrase_protected && (
            <Lock
              size={11}
              aria-label="Passphrase protected"
              style={{ marginLeft: 'var(--sp-1)', color: 'var(--info)', verticalAlign: '-1px' }}
            />
          )}
        </span>
        <small className="pgp-mono" title={item.label ? `Internal label: ${item.label}` : undefined}>
          {item.key_id}{item.label && item.user_ids[0] ? ` · ${item.label}` : ''}
        </small>
      </div>

      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', minWidth: 0 }}>
        <StatusPill status={status} />
        {/* A key with no private half can never sign. It is the difference
            between "we publish this" and "we can answer with this", so it is a
            column-level fact, not a detail. */}
        {!item.can_sign && <span className="pgp-chip pgp-chip-warn" title="Public half only — this key cannot sign">Public</span>}
      </span>

      <span className="lrow-text" title={algorithmLabel(item)}>{algorithmLabel(item)}</span>

      {/* `lrow-wrap` gives the fingerprint its own full-width line once the row
          folds into a card, where forty hex characters have no business
          sharing a line with anything. */}
      <div className="pgp-lrow-fp lrow-wrap">
        <Fingerprints fingerprint={item.fingerprint} />
        <FingerprintBars fingerprint={item.fingerprint} />
      </div>

      <div className="lrow-stack" style={{ textAlign: 'right' }}>
        <span className="lrow-num">{shortDate(item.created_at)}</span>
        <small style={{ color: status.tone === 'expired' ? 'var(--warning)' : undefined }}>
          {item.expires_at ? `exp ${shortDate(item.expires_at)}` : 'no expiry'}
        </small>
      </div>

      <span className="lrow-actions">
        <KeyActions item={item} canExportPrivate={canExportPrivate} compact {...actions} />
      </span>
    </div>
  );
}

function KeyCard({ item, index, canExportPrivate, onActivate, onDeactivate, onRevoke, onDelete, onExport, busy }) {
  const status = keyStatus(item);

  return (
    <article className={`glass-card pgp-card pgp-card-${status.tone}`} style={{ '--pgp-i': index }}>
      <div className="pgp-card-top">
        <div className="pgp-card-ident">
          <h4 className="pgp-card-title">{item.user_ids[0] || item.label || item.key_id}</h4>
          <div className="pgp-card-meta">
            <StatusPill status={status} />
            <span className="pgp-chip">{algorithmLabel(item)}</span>
            {item.passphrase_protected && <span className="pgp-chip pgp-chip-lock"><Lock size={12} /> Passphrase</span>}
            {!item.can_sign && <span className="pgp-chip pgp-chip-warn">Public only</span>}
          </div>
        </div>
      </div>

      <Fingerprints fingerprint={item.fingerprint} />
      <FingerprintBars fingerprint={item.fingerprint} />

      <div className="pgp-card-dates">
        <span>Created {shortDate(item.created_at)}</span>
        <span>
          {item.expires_at ? `Expires ${shortDate(item.expires_at)}` : 'No expiry'}
        </span>
        {item.label && item.user_ids[0] && <span className="pgp-dim">{item.label}</span>}
      </div>

      {/* Drawn by the same function the line item uses. The two views existing
          side by side is exactly how one of them quietly loses an action —
          `KeyActions` makes "add a button to the cards only" hard to write. */}
      <div className="pgp-card-actions">
        <KeyActions
          item={item}
          canExportPrivate={canExportPrivate}
          onActivate={onActivate}
          onDeactivate={onDeactivate}
          onRevoke={onRevoke}
          onDelete={onDelete}
          onExport={onExport}
          busy={busy}
        />
      </div>
    </article>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function AdminPgpKeys() {
  const [keys, setKeys] = useState([]);
  const [keyTypes, setKeyTypes] = useState([]);
  const [canExportPrivate, setCanExportPrivate] = useState(false);
  // Whether the decrypt desk is offered: the server says, because the route
  // answers to orders.decrypt_address on top of the PGP grant.
  const [canDecrypt, setCanDecrypt] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState(null);          // 'generate' | 'import' | null
  const [revoking, setRevoking] = useState(null);    // key pending revocation
  const [revokeReason, setRevokeReason] = useState('');
  const [revokePassphrase, setRevokePassphrase] = useState('');
  const [exported, setExported] = useState(null);    // { key, part, armored }
  const [exportShown, setExportShown] = useState(false);
  // Cards or line items for the archive below, remembered per operator. An
  // operator who rotates keys works in the compact view and should not have to
  // re-choose it every time they come back to check what is published.
  const [density, setDensity] = useViewMode('admin-pgp-keys');

  const load = useCallback(async () => {
    try {
      const data = await api.get('/store-pgp/keys');
      setKeys(data.keys);
      setKeyTypes(data.key_types);
      setCanExportPrivate(data.can_export_private);
      setCanDecrypt(data.can_decrypt === true);
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeKey = useMemo(() => keys.find((k) => k.active), [keys]);
  const signingKeys = useMemo(() => keys.filter((k) => k.can_sign && !k.revoked_at), [keys]);

  const run = async (fn, successMessage) => {
    setBusy(true);
    try {
      await fn();
      if (successMessage) toast.success(successMessage);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  /**
   * Publish a key, and say what that did to the orders already in flight.
   *
   * Nothing is re-wrapped by activating — a buyer's sealed address is theirs —
   * so every unshipped order encrypted to the OUTGOING key is now readable only
   * by putting that key back. The server counts them and returns the number;
   * without this the operator met them one at a time at the Ship desk, days
   * later, as orders that would not decrypt.
   *
   * A persistent toast rather than a line on the card: it is true at the moment
   * of the swap and it is the only moment the person is thinking about keys.
   * Null means the count could not be taken, which is rendered as silence — "no
   * orders are stranded" and "we did not manage to look" must not read alike.
   */
  const activate = (key) => run(async () => {
    const res = await api.post(`/store-pgp/keys/${key.id}/activate`);
    const n = res?.orders_sealed_to_other_keys;
    if (typeof n === 'number' && n > 0) {
      toast(
        `${n} order${n === 1 ? '' : 's'} still waiting to ship ${n === 1 ? 'is' : 'are'} encrypted to the previous key. `
        + `Their addresses open only while that key is the active one — keep it, and re-activate it if you need to read them.`,
        { icon: '🔑', duration: 12000 },
      );
    }
  }, 'Key published');
  const deactivate = (key) => run(() => api.post(`/store-pgp/keys/${key.id}/deactivate`), 'Key unpublished');

  const remove = (key) => {
    if (!confirm(`Delete this key permanently?\n\n${key.fingerprint}\n\nIf the private half is stored here and nowhere else, it is gone for good.`)) return;
    return run(() => api.delete(`/store-pgp/keys/${key.id}`), 'Key deleted');
  };

  const confirmRevoke = () => run(async () => {
    await api.post(`/store-pgp/keys/${revoking.id}/revoke`, {
      reason: revokeReason,
      passphrase: revokePassphrase,
    });
    setRevoking(null);
    setRevokeReason('');
    setRevokePassphrase('');
  }, 'Key revoked');

  const exportPart = async (key, part) => {
    try {
      const data = await api.get(`/store-pgp/keys/${key.id}/export?part=${part}`);
      setExported({ key, part, armored: data.armored });
      setExportShown(false);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const afterCreate = async () => {
    setPanel(null);
    await load();
  };

  const subtitle = loading ? 'Loading…'
    : activeKey ? <>Publishing <span className="pgp-mono">{activeKey.key_id}</span>{activeKey.expires_at ? ` · expires ${relativeDays(activeKey.expires_at)}` : ' · no expiry'}</>
      : keys.length ? `${keys.length} key${keys.length === 1 ? '' : 's'} stored, none published`
        : 'No store key yet — customers cannot verify anything you sign';

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--sp-12)' }}>
        <ProgressBar label="Loading PGP keys…" />
      </div>
    );
  }

  return (
    <div className="admin-page pgp-page">
      <PageHeader icon={KeyRound} title="Store PGP key" subtitle={subtitle}>
        <button
          className="glass-btn glass-btn-primary"
          onClick={() => setPanel(panel === 'generate' ? null : 'generate')}
        >
          <Plus size={16} /> Generate
        </button>
        <button
          className="glass-btn"
          onClick={() => setPanel(panel === 'import' ? null : 'import')}
        >
          <Upload size={16} /> Import
        </button>
      </PageHeader>

      {activeKey ? (
        <ActiveKeyHero
          activeKey={activeKey}
          canExportPrivate={canExportPrivate}
          onUnpublish={deactivate}
          onRevoke={setRevoking}
          onExport={exportPart}
          busy={busy}
        />
      ) : (
        <EmptyHero onGenerate={() => setPanel('generate')} onImport={() => setPanel('import')} />
      )}

      {panel === 'generate' && (
        <GeneratePanel keyTypes={keyTypes} onDone={afterCreate} onCancel={() => setPanel(null)} />
      )}
      {panel === 'import' && (
        <ImportPanel onDone={afterCreate} onCancel={() => setPanel(null)} />
      )}

      {/* Revocation asks rather than confirms: it is irreversible, and a
          passphrase-locked key with no stored certificate needs the passphrase
          to produce the revocation at all. */}
      {revoking && (
        <section className="glass-card admin-panel-in pgp-panel pgp-danger-panel">
          <div className="pgp-panel-head">
            <h3 className="admin-card-title"><AlertTriangle size={16} /> Revoke this key</h3>
            <button type="button" className="pgp-icon-btn" onClick={() => setRevoking(null)} aria-label="Close"><X size={16} /></button>
          </div>
          <p className="admin-hint">
            Revocation is permanent and public. The stored block is replaced by
            its revoked form so anyone who pinned{' '}
            <span className="pgp-mono">{revoking.key_id}</span> can see it should
            no longer be trusted. The key stops signing and is unpublished.
          </p>
          <Fingerprints fingerprint={revoking.fingerprint} />
          <div className="admin-form-grid">
            <div className="form-group">
              <label>Reason (optional)</label>
              <input className="glass-input" value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} placeholder="Rotating to a new key" />
            </div>
            {revoking.passphrase_protected && !revoking.has_revocation_certificate && (
              <div className="form-group">
                <label>Passphrase</label>
                <input className="glass-input" type="password" value={revokePassphrase} onChange={(e) => setRevokePassphrase(e.target.value)} autoComplete="new-password" />
              </div>
            )}
          </div>
          <div className="admin-form-actions">
            <button className="glass-btn glass-btn-danger" onClick={confirmRevoke} disabled={busy}>
              <Ban size={16} /> Revoke permanently
            </button>
            <button className="glass-btn" onClick={() => setRevoking(null)} disabled={busy}>Cancel</button>
          </div>
        </section>
      )}

      {/* Exported material is kept behind one more click. A private key on
          screen is a private key in a screenshot, a screen share, or whatever
          is behind the operator. */}
      {exported && (
        <section className={`glass-card admin-panel-in pgp-panel${exported.part === 'private' ? ' pgp-danger-panel' : ''}`}>
          <div className="pgp-panel-head">
            <h3 className="admin-card-title">
              {exported.part === 'private' ? <><Lock size={16} /> Private key</> : <><ShieldOff size={16} /> Revocation certificate</>}
              <span className="pgp-mono pgp-dim"> · {exported.key.key_id}</span>
            </h3>
            <button type="button" className="pgp-icon-btn" onClick={() => setExported(null)} aria-label="Close"><X size={16} /></button>
          </div>

          {exported.part === 'private' ? (
            <p className="pgp-note pgp-note-danger">
              <AlertTriangle size={13} /> Anyone holding this block can sign as your store. This export was recorded in the audit log.
            </p>
          ) : (
            <p className="admin-hint">
              Store this offline. It revokes the key even if the passphrase is lost.
            </p>
          )}

          <div className="admin-form-actions">
            <button className="glass-btn" onClick={() => setExportShown((v) => !v)}>
              {exportShown ? <><EyeOff size={16} /> Hide</> : <><Eye size={16} /> Reveal</>}
            </button>
            <CopyButton value={exported.armored} label="Copy" className="glass-btn" />
            <button
              className="glass-btn"
              onClick={() => downloadArmor(`store-pgp-${exported.key.key_id}-${exported.part}.asc`, exported.armored)}
            >
              <Download size={16} /> Download
            </button>
          </div>

          {exportShown && <pre className="pgp-armor admin-panel-in">{exported.armored}</pre>}
        </section>
      )}

      {/* The desk: sign on the left, verify on the right, side by side where
          there is room. A store with no signing key still gets the verify
          half — checking a customer's signed message needs no key of its own. */}
      <div className="pgp-desk">
        {signingKeys.length > 0 && <SignPanel signingKeys={signingKeys} />}
        <VerifyPanel hasStoreKeys={keys.length > 0} />
        {/* Decrypting needs a private half to unlock and the address grant to
            unlock it with; without either the desk is simply not offered. */}
        {canDecrypt && keys.some((k) => k.can_sign) && <DecryptPanel keys={keys} />}
      </div>

      {keys.length > 0 && (
        <>
          <div className="pgp-section-head">
            <h3><KeyRound size={16} /> All keys</h3>
            <div className="pgp-section-tools">
              <button className="glass-btn glass-btn-sm" onClick={load} disabled={busy}>
                <RefreshCw size={14} /> Refresh
              </button>
              <ViewToggle value={density} onChange={setDensity} label="Key archive layout" />
            </div>
          </div>
          {/* See the DESIGN §6 note above `KeyActions`: this list is a toggle,
              and the archive is the half that needed the compact view — twenty
              keys as cards is a page and a half of scrolling to answer "which
              one is live". */}
          {density === 'rows' ? (
            <div
              className="lrows"
              style={{ '--lrow-cols': 'minmax(0,1fr) 150px 128px minmax(0,1.5fr) 104px 188px' }}
            >
              <div className="lrows-head">
                <span>Key</span>
                <span>Status</span>
                <span>Algorithm</span>
                <span>Fingerprint</span>
                <span style={{ textAlign: 'right' }}>Created</span>
                <span aria-hidden="true" />
              </div>
              {keys.map((item) => (
                <KeyRow
                  key={item.id}
                  item={item}
                  canExportPrivate={canExportPrivate}
                  onActivate={activate}
                  onDeactivate={deactivate}
                  onRevoke={setRevoking}
                  onDelete={remove}
                  onExport={exportPart}
                  busy={busy}
                />
              ))}
            </div>
          ) : (
            <div className="pgp-grid">
              {keys.map((item, i) => (
                <KeyCard
                  key={item.id}
                  item={item}
                  index={i}
                  canExportPrivate={canExportPrivate}
                  onActivate={activate}
                  onDeactivate={deactivate}
                  onRevoke={setRevoking}
                  onDelete={remove}
                  onExport={exportPart}
                  busy={busy}
                />
              ))}
            </div>
          )}
        </>
      )}
      <NextStops route="/admin/pgp" />
    </div>
  );
}
