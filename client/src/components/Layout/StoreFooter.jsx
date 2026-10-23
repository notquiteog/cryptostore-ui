import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { resolveStoreLink } from '../../config/storeLinks';
import { api } from '../../utils/api';
import { classifyAddress } from '../../utils/mirrors';

/**
 * Which mirror the visitor is on, and whether it is in the signed list.
 *
 * The comparison is CLIENT-SIDE against `window.location.host`, on purpose:
 * a visitor on a slow or partially-broken mirror still gets an answer as soon
 * as the list arrives, and the server never learns which host the visitor
 * typed. The list itself comes from the public mirrors endpoint — signed by
 * the store key when the store can sign unattended, and the strip says when
 * it is not, because an unsigned list is a claim and a signed one is
 * evidence.
 *
 * Absent entirely when the operator has listed no mirrors. A store with one
 * address has nothing to say here, and a strip reading "you are on the only
 * address" is furniture.
 */
function MirrorStrip() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/settings/mirrors').then((d) => { if (alive) setData(d); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!data || !Array.isArray(data.mirrors) || data.mirrors.length === 0) return null;

  // The same verdict the sign-in page's address check gives, from the same
  // function (utils/mirrors.js) — the strip and the check must never
  // disagree about an address.
  const { host: here, status, mirror: listed, lookalike } = classifyAddress(window.location.host, data.mirrors);
  const signed = !!data.signed;

  let tone = 'is-ok';
  let Icon = ShieldCheck;
  let text;
  if (status === 'listed') {
    text = <>You are on <b>{here}</b>, a listed mirror{listed?.label ? ` (${listed.label})` : ''}.</>;
  } else if (status === 'local') {
    // Local development and previews are never in a published list; saying
    // "not a listed mirror" about localhost would be true and useless.
    tone = 'is-quiet';
    Icon = Shield;
    text = <>You are on <b>{here}</b> — a local address, not one of the {data.mirrors.length} published mirrors.</>;
  } else {
    tone = 'is-warn';
    Icon = ShieldAlert;
    text = (
      <>
        <b>{here}</b> is not in this store's mirror list.
        {lookalike ? <> It resembles <b>{lookalike.host}</b>, which is.</> : null}
        {' '}Check the signed list before trusting this address.
      </>
    );
  }

  return (
    <div className={`mirror-strip ${tone}`} role="status">
      <Icon size={14} aria-hidden="true" />
      <span className="mirror-strip-text">
        {text}
        {' '}
        <a href="/mirrors.txt" target="_blank" rel="noopener noreferrer">
          {signed ? 'Signed mirror list' : 'Mirror list'}
        </a>
        {!signed && data.unsigned_reason && (
          <span className="mirror-strip-unsigned" title={data.unsigned_reason}> · unsigned</span>
        )}
      </span>
    </div>
  );
}

/**
 * The storefront footer. Off by default; the operator enables it and picks
 * its links from a fixed roster on the Settings page.
 *
 * The roster and the three rules that decide whether a stored id actually
 * draws — unknown id, needs a session, page unpublished — live in
 * `config/storeLinks.js`, because the home page's promises section links the
 * same way and two copies of that logic would diverge the first time a page
 * was renamed. `server/config/pageKeys.js` enforces the same id list on
 * write, so the stored blob cannot point a visitor anywhere the store itself
 * doesn't go.
 */
export default function StoreFooter() {
  const { settings } = useTheme();
  const { user } = useAuth();

  // The mirror strip stands on its own: it is drawn whether or not the
  // operator switched the footer's links on, because "which address am I on"
  // is a question a visitor has regardless of whether the store wants a
  // footer. It renders nothing when no mirrors are listed.
  if (settings.footer_enabled !== 'true') {
    return (
      <footer className="store-footer is-strip-only">
        <div className="container store-footer-inner">
          <MirrorStrip />
        </div>
      </footer>
    );
  }

  let ids = [];
  try {
    const parsed = JSON.parse(settings.footer_links || '[]');
    if (Array.isArray(parsed)) ids = parsed;
  } catch { /* bad blob = no links; the text line may still carry the footer */ }

  const links = ids
    .map((id) => resolveStoreLink(id, { settings, user }))
    .filter(Boolean);

  const text = (settings.footer_text || '').trim();
  if (links.length === 0 && !text) return null;

  return (
    <footer className="store-footer">
      <div className="container store-footer-inner">
        <div className="store-footer-brand">
          <span className="store-footer-name">{settings.store_name || 'CryptoStore'}</span>
          {settings.store_tagline && (
            <span className="store-footer-tagline">{settings.store_tagline}</span>
          )}
        </div>

        {links.length > 0 && (
          <nav className="store-footer-links" aria-label="Footer">
            {links.map((l) => (
              l.href
                ? <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer">{l.label}</a>
                : <Link key={l.id} to={l.to}>{l.label}</Link>
            ))}
          </nav>
        )}

        {text && <p className="store-footer-text">{text}</p>}
        <MirrorStrip />
      </div>
    </footer>
  );
}
