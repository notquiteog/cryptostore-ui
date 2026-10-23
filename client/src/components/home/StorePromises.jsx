import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api } from '../../utils/api';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { promiseIcon } from '../../config/promiseIcons';
import { resolveStoreLink } from '../../config/storeLinks';

/**
 * The store's promises: the operator's own claims, and where a buyer can go
 * to check them.
 *
 * ── What it is, and why it is not three cards ──────────────────────────────
 *
 * Every storefront on earth has this section and almost every one of them is
 * DESIGN §1's first tell — three equal cards, icon over title over one
 * sentence, admitting that nobody asked which claim mattered. The claims are
 * not equal: "third-party lab tested, here are the certificates" is a
 * different kind of statement from "we like our customers", and a layout that
 * prints them identically is lying about both.
 *
 * So the section is asymmetric and it is a LEDGER, not a row. The operator's
 * headline holds one column; the promises run down the other as line items on
 * a single spine, each one sealed with its own mark, each one carrying the
 * link that backs it where such a link exists. It reads at four promises and
 * at one, and it does not become a row of anything.
 *
 * ── The flourish, and the job it does (DESIGN §10) ─────────────────────────
 *
 * A promise that can be checked is a promise somebody countersigned. So the
 * marks are seals and they are STAMPED: as the section comes into view the
 * spine grows downward, and each seal's ring draws itself and takes its glyph
 * a beat later, in order, top to bottom. What the motion says is literally
 * what the section claims — these are checks, and they were run, and they
 * passed. A row of cards fading in together says nothing at all.
 *
 * The animation is opt-in rather than opt-out, which is the opposite of how
 * these are usually written and is deliberate: the drawn state is what the
 * CSS renders by default, and `is-armed` is added from script only once we
 * know an observer exists and the visitor has not asked for less motion. A
 * section whose content is hidden until an IntersectionObserver fires is a
 * section that is blank forever the day the observer does not.
 */

/**
 * The section itself, given its content.
 *
 * Split from the fetching wrapper below so the admin editor renders THIS —
 * the same markup, the same stylesheet, the same stamp — rather than an
 * approximation of it. The custom-page editor already works this way with the
 * markdown renderer, and the reason holds here: a preview that is a second
 * implementation is a preview that will eventually be wrong about the thing
 * it exists to show.
 */
export function PromisesSection({ eyebrow: rawEyebrow, heading: rawHeading, lede: rawLede, promises: rawPromises }) {
  const { settings } = useTheme();
  const { user } = useAuth();
  const rootRef = useRef(null);
  // Generated rather than a literal: the admin editor renders this component
  // as its own live preview, on a page that already has headings of its own.
  const headingId = useId();

  const promises = Array.isArray(rawPromises) ? rawPromises : [];

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;

    // No observer, or a visitor who asked for less motion: leave the section
    // in its drawn state and never arm it. `55-reduced-motion.css` cancels
    // the animations as well, so this is a belt-and-braces that also covers
    // the browser without IntersectionObserver.
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') return undefined;

    el.classList.add('is-armed');
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      el.classList.add('is-stamped');
      // One stamping, not one per scroll pass. Re-running it every time the
      // section came back into view would turn a flourish into a tic.
      io.disconnect();
    }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [promises.length]);

  if (promises.length === 0) return null;

  const eyebrow = (rawEyebrow || '').trim();
  const heading = (rawHeading || '').trim();
  const lede = (rawLede || '').trim();
  // An operator may want the promises alone, with no headline block at all.
  // Rather than leaving half the grid empty, the list takes the full width.
  const hasLead = Boolean(eyebrow || heading || lede);

  return (
    <section
      ref={rootRef}
      className={`promises${hasLead ? '' : ' promises-bare'}`}
      aria-labelledby={heading ? headingId : undefined}
      aria-label={heading ? undefined : 'What this store promises'}
    >
      <div className="container container-wide promises-grid">
        {hasLead && (
          <div className="promises-lead">
            {eyebrow && <p className="promises-eyebrow">{eyebrow}</p>}
            {heading && <h2 id={headingId} className="promises-heading">{heading}</h2>}
            {lede && <p className="promises-lede">{lede}</p>}
          </div>
        )}

        <ul className="promises-list">
          {promises.map((p, i) => {
            const Icon = promiseIcon(p.icon);
            // Resolved through the same roster and the same three rules the
            // footer uses: an unknown id, a destination needing a session the
            // visitor doesn't have, or an unpublished page all drop the LINK
            // and keep the PROMISE. The claim is still true; only the proof
            // is currently unreachable for this reader.
            const link = p.link ? resolveStoreLink(p.link, { settings, user }) : null;
            const label = (p.link_label || '').trim() || (link ? link.label : '');

            const inner = (
              <>
                <span className="promise-mark" aria-hidden="true">
                  <svg className="promise-seal" viewBox="0 0 44 44" width="44" height="44">
                    <circle className="promise-seal-track" cx="22" cy="22" r="19" />
                    <circle className="promise-seal-draw" cx="22" cy="22" r="19" />
                  </svg>
                  <Icon className="promise-glyph" size={17} strokeWidth={1.9} />
                </span>

                <span className="promise-text">
                  <span className="promise-head">
                    <span className="promise-title">{p.title}</span>
                    {p.figure && <span className="promise-figure">{p.figure}</span>}
                  </span>
                  {p.body && <span className="promise-body">{p.body}</span>}
                  {link && (
                    <span className="promise-proof">
                      {label} <ArrowRight size={12} />
                    </span>
                  )}
                </span>
              </>
            );

            return (
              <li key={i} className="promise" style={{ '--i': i }}>
                {link
                  ? (link.href
                    ? <a className="promise-row is-linked" href={link.href} target="_blank" rel="noopener noreferrer">{inner}</a>
                    : <Link className="promise-row is-linked" to={link.to}>{inner}</Link>)
                  : <div className="promise-row">{inner}</div>}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * What the storefront mounts: the section, once the store has said whether it
 * has one.
 *
 * Nothing is drawn while the request is in flight and nothing is drawn if the
 * answer is no. Deliberately no skeleton — the section sits below the fold, so
 * a placeholder would only shift the page under someone who has not scrolled
 * to it yet, and a store that has written no promises should not be handed an
 * empty frame implying it forgot to.
 */
export default function StorePromises() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // Its own endpoint rather than the pre-session settings payload: this is
    // prose only the home page draws, and every other page in the store would
    // otherwise carry it (server/controllers/settingsController.getHomePromises).
    api.get('/settings/home-promises')
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setData({ enabled: false, promises: [] }); });
    return () => { cancelled = true; };
  }, []);

  if (!data?.enabled) return null;

  return (
    <PromisesSection
      eyebrow={data.eyebrow}
      heading={data.heading}
      lede={data.lede}
      promises={data.promises}
    />
  );
}
