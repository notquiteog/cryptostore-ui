import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShieldCheck, ShieldAlert, CalendarDays } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

/**
 * Age confirmation gateway.
 *
 * Shown before anything else when the store enables it, and remembered per
 * browser for a configurable window so a returning visitor is not re-asked on
 * every page load.
 *
 * Two modes:
 *   - confirm: a single "yes I am over N" button (the common shape)
 *   - dob:     enter a date of birth, checked against N
 *
 * Deliberately client-side. This is a disclaimer, not an access control: the
 * store's real access rules are the login and the invite system on the server.
 * Treating it as security would be worse than useless, because it would suggest
 * a guarantee the mechanism cannot make.
 */

const STORAGE_KEY = 'age_gate_ack';
const DEFAULT_AGE = 21;

/** Read the stored acknowledgement, discarding one that has expired or aged out. */
function readAck(minAge) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const ack = JSON.parse(raw);
    if (!ack || typeof ack !== 'object') return null;
    if (ack.expiresAt && Date.now() > ack.expiresAt) return null;
    // A store that raises its minimum age must re-ask everyone who only ever
    // confirmed the old, lower one.
    if (typeof ack.age === 'number' && ack.age < minAge) return null;
    return ack;
  } catch {
    return null;
  }
}

function writeAck(minAge, rememberDays) {
  try {
    const days = Number(rememberDays);
    const ttl = Number.isFinite(days) && days > 0 ? days * 86400000 : null;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      age: minAge,
      at: Date.now(),
      expiresAt: ttl ? Date.now() + ttl : null,
    }));
  } catch {
    // Private browsing with storage disabled: the gate simply asks again.
  }
}

/** Whole years elapsed, calendar-correct (a birthday later this year does not count). */
function yearsSince(year, month, day) {
  const dob = new Date(year, month - 1, day);
  if (dob.getFullYear() !== year || dob.getMonth() !== month - 1 || dob.getDate() !== day) return null;
  const now = new Date();
  let age = now.getFullYear() - year;
  const beforeBirthday = now.getMonth() < month - 1
    || (now.getMonth() === month - 1 && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * @param {object}   props
 * @param {boolean}  [props.preview]  Force the gate open and make its buttons
 *   dismiss instead of recording an answer. Lets the admin page show the real
 *   component rather than a mock-up that can drift from it.
 * @param {Function} [props.onClose]  Called when a preview is dismissed.
 */
export default function AgeGate({ preview = false, onClose }) {
  const { settings, loaded } = useTheme();

  const enabled = settings.age_gate_enabled === 'true';
  const minAge = useMemo(() => {
    const parsed = parseInt(settings.age_gate_min_age, 10);
    return Number.isFinite(parsed) && parsed > 0 && parsed < 130 ? parsed : DEFAULT_AGE;
  }, [settings.age_gate_min_age]);
  const requireDob = settings.age_gate_require_dob === 'true';

  const [acknowledged, setAcknowledged] = useState(() => Boolean(readAck(DEFAULT_AGE)));
  const [declined, setDeclined] = useState(false);
  const [dob, setDob] = useState({ day: '', month: '', year: '' });
  const [error, setError] = useState('');
  const confirmRef = useRef(null);
  const firstFieldRef = useRef(null);

  // Re-check once the real minimum age arrives: the optimistic first read used
  // the default, and a store with a higher bar must not be let through on it.
  useEffect(() => {
    if (!loaded) return;
    setAcknowledged(Boolean(readAck(minAge)));
  }, [loaded, minAge]);

  const open = preview || (loaded && enabled && !acknowledged);

  // While the gate is up nothing behind it should scroll or take focus.
  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      (requireDob ? firstFieldRef : confirmRef).current?.focus();
    }, 60);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
    };
  }, [open, requireDob]);

  const accept = useCallback(() => {
    // A preview must never record an answer: the admin checking their copy is
    // not the visitor being asked, and writing the flag here would stop the
    // real gate appearing for them afterwards.
    if (preview) return onClose?.();
    writeAck(minAge, settings.age_gate_remember_days);
    setAcknowledged(true);
  }, [preview, onClose, minAge, settings.age_gate_remember_days]);

  const submitDob = (e) => {
    e.preventDefault();
    const day = parseInt(dob.day, 10);
    const month = parseInt(dob.month, 10);
    const year = parseInt(dob.year, 10);
    if (!day || !month || !year || String(year).length !== 4) {
      setError('Enter your full date of birth.');
      return;
    }
    const age = yearsSince(year, month, day);
    if (age === null) {
      setError('That date does not exist.');
      return;
    }
    if (age < 0 || age > 129) {
      setError('Enter a valid date of birth.');
      return;
    }
    if (age < minAge) {
      setError('');
      setDeclined(true);
      return;
    }
    setError('');
    accept();
  };

  const decline = () => setDeclined(true);

  const leave = () => {
    if (preview) return onClose?.();
    const url = (settings.age_gate_decline_url || '').trim();
    if (/^https?:\/\//i.test(url)) {
      window.location.href = url;
      return;
    }
    // No destination configured — the denial screen is the end of the road.
    setDeclined(true);
  };

  if (!open) return null;

  const storeName = settings.store_name || 'this store';
  const title = (settings.age_gate_title || '').trim() || `Are you ${minAge} or older?`;
  const message = (settings.age_gate_message || '').trim()
    || `You must be ${minAge} or over to enter ${storeName}. Please confirm your age to continue.`;

  // The gate is the first thing a visitor sees, so it has to look like the
  // store it is guarding. `navbar_logo_dynamic_color` is read here as well as
  // in the navbar: an admin who asked for the logo to follow the brand colour
  // meant the logo, not one particular bar it happens to sit in.
  const rounded = settings.favicon_rounded === 'true';
  const brandMark = (
    <div className="age-gate-brand">
      {settings.store_logo ? (
        settings.navbar_logo_dynamic_color === 'true' ? (
          <div
            role="img"
            aria-label={storeName}
            className={`age-gate-logo-dynamic${rounded ? ' age-gate-logo-round' : ''}`}
            style={{ '--logo-src': `url("${settings.store_logo}")` }}
          />
        ) : (
          <img
            className={`age-gate-logo${rounded ? ' age-gate-logo-round' : ''}`}
            src={settings.store_logo}
            alt={storeName}
          />
        )
      ) : (
        // No logo uploaded: the store name carries the card instead, rather
        // than a generic badge that says nothing about who is asking.
        <div className="age-gate-wordmark">{storeName}</div>
      )}
    </div>
  );

  if (declined) {
    return (
      <div className="age-gate age-gate-denied" role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
        <div className="age-gate-card">
          {brandMark}
          <div className="age-gate-chip">
            <ShieldAlert size={13} aria-hidden="true" /> Access denied
          </div>
          <h1 className="age-gate-title" id="age-gate-title">Sorry — you can’t enter</h1>
          <p className="age-gate-message">
            You must be {minAge} or older to browse {storeName}.
          </p>
          <div className="age-gate-actions">
            <button type="button" className="glass-btn age-gate-decline" onClick={() => { setDeclined(false); setDob({ day: '', month: '', year: '' }); }}>
              Go back
            </button>
            {preview && (
              <button type="button" className="glass-btn glass-btn-sm age-gate-decline" onClick={onClose}>
                Close preview
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
      <div className="age-gate-card">
        {preview && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={onClose}
            style={{ position: 'absolute', top: 'var(--sp-3)', right: 'var(--sp-3)' }}
          >
            Close preview
          </button>
        )}
        {brandMark}

        <div className="age-gate-chip">
          {requireDob
            ? <><CalendarDays size={13} aria-hidden="true" /> Date of birth</>
            : <><ShieldCheck size={13} aria-hidden="true" /> {minAge}+ only</>}
        </div>

        <h1 className="age-gate-title" id="age-gate-title">{title}</h1>
        <p className="age-gate-message">{message}</p>

        {requireDob ? (
          <form onSubmit={submitDob}>
            <div className="age-gate-dob">
              <input
                ref={firstFieldRef}
                className="glass-input age-gate-dob-day"
                inputMode="numeric"
                maxLength={2}
                placeholder="DD"
                aria-label="Day of birth"
                value={dob.day}
                onChange={(e) => setDob(d => ({ ...d, day: e.target.value.replace(/\D/g, '') }))}
              />
              <input
                className="glass-input age-gate-dob-month"
                inputMode="numeric"
                maxLength={2}
                placeholder="MM"
                aria-label="Month of birth"
                value={dob.month}
                onChange={(e) => setDob(d => ({ ...d, month: e.target.value.replace(/\D/g, '') }))}
              />
              <input
                className="glass-input age-gate-dob-year"
                inputMode="numeric"
                maxLength={4}
                placeholder="YYYY"
                aria-label="Year of birth"
                value={dob.year}
                onChange={(e) => setDob(d => ({ ...d, year: e.target.value.replace(/\D/g, '') }))}
              />
            </div>
            <p className="age-gate-error" role="alert">{error}</p>
            <div className="age-gate-actions">
              <button type="submit" className="glass-btn glass-btn-primary age-gate-confirm">
                <ShieldCheck size={17} /> Enter
              </button>
              <button type="button" className="glass-btn age-gate-decline" onClick={leave}>
                Leave
              </button>
            </div>
          </form>
        ) : (
          <div className="age-gate-actions">
            <button ref={confirmRef} type="button" className="glass-btn glass-btn-primary age-gate-confirm" onClick={accept}>
              <ShieldCheck size={17} /> Yes, I am {minAge} or older
            </button>
            <button type="button" className="glass-btn age-gate-decline" onClick={decline}>
              No, take me back
            </button>
          </div>
        )}

        <p className="age-gate-fineprint">
          By entering you confirm you are of legal age in your jurisdiction and accept
          responsibility for your visit. We store nothing but a local flag on this device
          so you are not asked again.
        </p>
      </div>
    </div>
  );
}
