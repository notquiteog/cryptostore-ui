import { useEffect, useId, useState } from 'react';
import { ShieldCheck, ShieldAlert, Shield, Globe, Search, KeyRound, ChevronDown } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { api } from '../utils/api';
import {
  classifyAddress, mirrorHref, KIND_LABEL, fingerprintGroups,
} from '../utils/mirrors';

/**
 * The address check on the sign-in and sign-up cards.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 *
 * A thin bar fused to the bottom edge of the card: green with the host on it
 * when the address is in the store's signed mirror list, red when it is not,
 * neutral for a local or unverifiable address. That much a person reads
 * without meaning to, which is the point — the one moment a clone pays off
 * is a password typed into it, and this sits directly under the field.
 * Pressing the bar unfolds the rest: what the verdict rests on, every address
 * the store does list, a box to check an address they were handed, the key
 * fingerprint and the signed list. Pressing again folds it back to the bar.
 *
 * ── What it can and cannot prove ────────────────────────────────────────────
 *
 * The list comes from the server the page loaded from. A clone can serve its
 * own list with itself on it, so a green bar is only as good as the
 * signature on /mirrors.txt checked against a key the visitor already holds
 * — the panel prints the fingerprint and says so, rather than letting the
 * colour do more work than it can. The check box, by contrast, IS
 * trustworthy on a genuine mirror: the address typed is compared in the
 * browser against the signed list and never sent anywhere, so the store
 * learns nothing about which link somebody was given.
 *
 * Absent when the store has published neither a mirror list nor a key: there
 * is nothing to check against, and a bar saying so is furniture.
 */

const TONE = {
  listed: { cls: 'is-ok', Icon: ShieldCheck, word: 'listed mirror' },
  local: { cls: 'is-quiet', Icon: Shield, word: 'local address' },
  unknown: { cls: 'is-quiet', Icon: Shield, word: 'unverified' },
  unlisted: { cls: 'is-bad', Icon: ShieldAlert, word: 'not a listed address' },
  empty: { cls: 'is-quiet', Icon: Shield, word: '' },
};

function Host({ children }) {
  return <b className="mc-host">{children}</b>;
}

export default function MirrorCheck() {
  const { settings } = useTheme();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputId = useId();
  const panelId = useId();

  useEffect(() => {
    let alive = true;
    api.get('/settings/mirrors')
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  // Nothing until the list has arrived: a bar that flips from grey to green
  // a beat after paint is a bar that trains people to ignore it. A failed
  // fetch keeps it absent too — a broken mirror endpoint is not a verdict.
  if (!data || failed) return null;

  const store = settings.store_name || 'This store';
  const mirrors = Array.isArray(data.mirrors) ? data.mirrors : [];
  const fingerprint = data.fingerprint || null;
  if (mirrors.length === 0 && !fingerprint) return null;

  const here = classifyAddress(window.location.host, mirrors);
  const checked = query.trim() ? classifyAddress(query, mirrors) : null;
  const tone = TONE[here.status] || TONE.unknown;
  const signed = Boolean(data.signed);

  let detail;
  switch (here.status) {
    case 'listed':
      detail = `${here.host} is one of ${store}’s listed addresses${here.mirror?.label ? ` (${here.mirror.label})` : ''}. `
        + (signed
          ? 'The list it was checked against is signed by the store key; pin it once and it verifies from any mirror.'
          : 'The list it was checked against is not signed yet, so it is the store’s claim rather than evidence.');
      break;
    case 'local':
      detail = mirrors.length
        ? `${here.host} is a local address — not one of the ${mirrors.length} published address${mirrors.length === 1 ? '' : 'es'}, which is expected on a development or self-hosted copy.`
        : `${here.host} is a local address, as expected on a development or self-hosted copy.`;
      break;
    case 'unlisted':
      detail = here.lookalike
        ? `${here.host} is not one of ${store}’s addresses. It resembles ${here.lookalike.host}, which is listed — the usual shape of a clone. Do not sign in here; use a listed address instead.`
        : `${here.host} is not one of ${store}’s addresses. A page here that looks like ${store} is not ${store}. Do not sign in here; use a listed address instead.`;
      break;
    default:
      detail = `${store} has not published a mirror list, so ${here.host} cannot be checked here. Its key fingerprint is below.`;
  }

  return (
    <div className={`mirror-check ${tone.cls}${open ? ' is-open' : ''}`}>
      {/* The bar. A button, because the whole strip is the control; the
          verdict word is in the text as well as the colour (DESIGN §3), and
          the chevron says there is more without saying what. */}
      <button
        type="button"
        className="mc-bar"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Fold the address check' : 'Show the address check'}
      >
        <tone.Icon size={13} aria-hidden="true" />
        <span className="mc-bar-host">{here.host}</span>
        {tone.word && <span className="mc-bar-word">{tone.word}</span>}
        <ChevronDown size={13} className="mc-bar-chev" aria-hidden="true" />
      </button>

      {/* Folds by its grid track (0fr → 1fr) so no height is measured, the
          receipt's trick. `inert` keeps the folded panel's input and links
          out of the tab order while it is closed. */}
      <div id={panelId} className="mc-panel" inert={!open} aria-hidden={!open}>
        <div className="mc-panel-clip">
          <div className="mc-inner">
            <p className="mc-detail">{detail}</p>

            {mirrors.length > 0 && (
              <div className="mc-body">
                <div className="mc-mirrors">
                  <h4><Globe size={12} aria-hidden="true" /> {store} is reachable at</h4>
                  <ul className="mc-list">
                    {mirrors.map((m) => (
                      <li key={m.host} className={m.host === here.host ? 'is-here' : ''}>
                        <a href={mirrorHref(m)} className="mc-mirror" title={m.label || m.host}>
                          <span className={`mc-kind mc-kind-${m.kind}`}>{KIND_LABEL[m.kind] || m.kind}</span>
                          <span className="mc-mirror-host">{m.host}</span>
                          {m.label && <span className="mc-mirror-label">{m.label}</span>}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>

                <form className="mc-check" onSubmit={(e) => e.preventDefault()}>
                  <label htmlFor={inputId}><Search size={12} aria-hidden="true" /> Check an address you were given</label>
                  <input
                    id={inputId}
                    className="glass-input mc-input"
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="https://… or a .onion"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  {checked && checked.status !== 'empty' && (
                    <p className={`mc-result ${TONE[checked.status].cls}`} role="status">
                      {checked.status === 'listed' && <><ShieldCheck size={13} aria-hidden="true" /> <Host>{checked.host}</Host> is listed{checked.mirror?.label ? ` (${checked.mirror.label})` : ''}.</>}
                      {checked.status === 'local' && <><Shield size={13} aria-hidden="true" /> <Host>{checked.host}</Host> is a local address, not a published one.</>}
                      {checked.status === 'unlisted' && (
                        <>
                          <ShieldAlert size={13} aria-hidden="true" /> <Host>{checked.host}</Host> is not one of {store}&rsquo;s addresses.
                          {checked.lookalike ? ` It resembles ${checked.lookalike.host}, which is.` : ''}
                        </>
                      )}
                    </p>
                  )}
                  <p className="mc-privacy">Checked in your browser against the list above. What you type here is not sent anywhere.</p>
                </form>
              </div>
            )}

            <p className="mc-foot">
              {fingerprint && (
                <span className="mc-fp" title={fingerprint}>
                  <KeyRound size={11} aria-hidden="true" />
                  <span className="mc-fp-label">Store key</span>
                  <code>{fingerprintGroups(fingerprint).join(' ')}</code>
                </span>
              )}
              {mirrors.length > 0 && (
                <a href="/mirrors.txt" target="_blank" rel="noopener noreferrer">
                  {signed ? 'Signed list' : 'List'}
                </a>
              )}
              {mirrors.length > 0 && !signed && data.unsigned_reason && (
                <span className="mc-unsigned" title={data.unsigned_reason}>unsigned</span>
              )}
              <span className="mc-how">
                The colour proves only what the signature proves: check the list against a key you already trust.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
