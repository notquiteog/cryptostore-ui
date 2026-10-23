import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ShieldCheck, Star } from 'lucide-react';
import { api } from '../../utils/api';
import { relTime } from '../../utils/adminFormat';

/**
 * The home page's recent-reviews band: what buyers actually said, over a
 * store-wide tally of every rating behind it.
 *
 * ── What it is, and why it is not a carousel of testimonials ───────────────
 *
 * The generic version of this section is three quote cards on a slider, each
 * one a smiling sentence somebody chose. That is DESIGN §1's row-of-three plus
 * its "only the happy path exists" tell, and worse, it is unfalsifiable: a
 * visitor has no way to tell curated praise from all the praise there is.
 *
 * So the band is asymmetric and it is built the other way round. The TALLY
 * holds one column — the mean, and a five-bucket distribution counted over
 * every visible review at every rating, including the ones the operator would
 * rather not quote. The QUOTES run down the other as a feed of line items.
 * The tally is the claim; the quotes are the texture. A store showing only its
 * five-star reviews still prints its own one-star bar next to them, which is
 * the property that makes the section worth believing at all.
 *
 * ── Why the numbers and the stars are the same colour ─────────────────────
 *
 * The distribution bars are drawn in `--warning`, which is the colour
 * `StarRating` fills a star with. The bars ARE the stars, counted — rendering
 * the same fact in two places in two different colours is how a reader ends up
 * treating them as two facts.
 *
 * ── Bar widths are proportional to the total, not to the largest bucket ────
 *
 * Scaling each bar against the biggest one is the common trick and it flatters:
 * a store with 96 fives and 2 ones draws the ones at 2% of the row rather than
 * as the sliver they are. This scales against the TOTAL, so the shape of the
 * bars is the shape of the opinion. The floor is that a non-zero bucket always
 * gets a visible sliver — a bar of literally zero width for two real reviews
 * would be the same lie pointing the other way — and the exact count sits
 * beside every bar regardless, so the number is the truth and the bar is the
 * picture.
 *
 * ── Motion, and why there is deliberately not much ────────────────────────
 *
 * The bars grow from nothing when the band scrolls into view, 5 down to 1,
 * because that is honestly what a tally does: it accumulates. That is the
 * whole flourish. The promises section sits directly BELOW this one and its
 * seals stamp themselves in sequence — two set pieces stacked would compete,
 * and the one that fixed a real problem (DESIGN §10) is the stamp. So this
 * band moves once, briefly, and then holds still.
 *
 * Armed rather than gated, the same way `StorePromises` is: the drawn state is
 * what the CSS renders by default and `is-armed` is added from script only
 * once we know an observer exists and the visitor has not asked for less
 * motion. A band whose bars are hidden until an IntersectionObserver fires is
 * a band that is blank forever on the day the observer does not.
 *
 * ── §6: which list shape is this ──────────────────────────────────────────
 *
 * Neither the responsive table nor two purpose-built views nor a toggle. Those
 * three answer "an operator is scanning four hundred records"; this is at most
 * twelve quotes of prose on a storefront, read rather than scanned, with no
 * columns to align and nothing to sort. It gets one view that reflows: the
 * tally beside the feed on a wide container, the tally above it as a compact
 * band on a phone, with the same fields in both. Nothing is hidden at either
 * size — which is the actual rule §6 is protecting.
 */

/** The store's own words, or ours — never an empty headline. */
const DEFAULT_HEADING = 'What buyers said';

/**
 * One row of the distribution: the rating, its bar, its count.
 *
 * `--bar` is the honest proportion and rides as a custom property so the
 * stylesheet owns the sliver floor and the growth animation; this component
 * only supplies the number.
 */
function DistributionRow({ rating, count, total, index }) {
  const share = total > 0 ? count / total : 0;
  return (
    <div className="rvb-dist-row" style={{ '--bar': share, '--i': index }}>
      <span className="rvb-dist-rating">
        {rating}<Star size={9} fill="currentColor" strokeWidth={0} aria-hidden="true" />
      </span>
      <span className="rvb-dist-track">
        <span className={`rvb-dist-fill${count === 0 ? ' is-empty' : ''}`} />
      </span>
      <span className="rvb-dist-count">{count.toLocaleString()}</span>
    </div>
  );
}

/**
 * Five stars at a given rating, drawn as one shape rather than five glyphs.
 *
 * `StarRating` is the store's star component and this deliberately does not
 * use it: it prints ★/☆ text glyphs sized in px, which is right in a product
 * card and wrong here, where the row needs stars small and tight enough to sit
 * on a line of metadata without setting the line height. Same colour token,
 * same five-star reading, no second opinion about what a filled star means.
 */
function Stars({ rating, size = 12 }) {
  return (
    <span className="rvb-stars" style={{ '--star-size': `${size}px` }} role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={size}
          aria-hidden="true"
          className={n <= rating ? 'is-on' : 'is-off'}
          fill={n <= rating ? 'currentColor' : 'none'}
          strokeWidth={n <= rating ? 0 : 1.6}
        />
      ))}
    </span>
  );
}

/**
 * The band, given its content.
 *
 * Split from the fetching wrapper below for the reason `StorePromises` splits:
 * the admin editor renders THIS, against this stylesheet, rather than a
 * mock-up that will eventually be confidently wrong about the thing it exists
 * to preview.
 */
export function ReviewsBand({ heading: rawHeading, reviews, totalCount, averageRating, distribution }) {
  const rootRef = useRef(null);
  // Generated, not a literal: the admin editor draws this on a page that
  // already has headings of its own.
  const headingId = useId();
  // One clock for every row, rather than each quote holding its own — the same
  // arrangement `relTime` was written for.
  const now = useMemo(() => Date.now(), [reviews]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') return undefined;

    el.classList.add('is-armed');
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      el.classList.add('is-counted');
      // Once. Re-running the tally every time the band scrolls back past would
      // turn a flourish into a tic.
      io.disconnect();
    }, { rootMargin: '0px 0px -12% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [reviews]);

  const list = Array.isArray(reviews) ? reviews : [];
  const buckets = Array.isArray(distribution) && distribution.length === 5 ? distribution : [0, 0, 0, 0, 0];
  const total = Number(totalCount) || 0;

  // Nothing true to say, so nothing drawn — the rule the whole home rail
  // follows. An empty frame captioned "no reviews yet" on a store's front door
  // advertises the absence rather than the store.
  if (list.length === 0) return null;

  const heading = (rawHeading || '').trim() || DEFAULT_HEADING;
  const average = Number(averageRating);
  const hasAverage = Number.isFinite(average);

  return (
    <section ref={rootRef} className="rvb" aria-labelledby={headingId}>
      <div className="container container-wide rvb-grid">
        <div className="rvb-tally">
          <p className="rvb-eyebrow">Reviews</p>
          <h2 id={headingId} className="rvb-heading">{heading}</h2>

          {hasAverage && (
            <div className="rvb-score">
              <span className="rvb-score-num">{average.toFixed(1)}</span>
              <span className="rvb-score-side">
                <Stars rating={Math.round(average)} size={14} />
                <span className="rvb-score-count">
                  {total.toLocaleString()} {total === 1 ? 'review' : 'reviews'}
                </span>
              </span>
            </div>
          )}

          <div
            className="rvb-dist"
            role="img"
            aria-label={`Rating spread: ${[5, 4, 3, 2, 1]
              .map((r) => `${r} star, ${buckets[r - 1] || 0}`)
              .join('; ')}`}
          >
            {[5, 4, 3, 2, 1].map((rating, i) => (
              <DistributionRow
                key={rating}
                rating={rating}
                count={buckets[rating - 1] || 0}
                total={total}
                index={i}
              />
            ))}
          </div>

          {/* One statement, said once, instead of a "verified purchase" badge
              repeated on every row. Every review in this table is bound to a
              delivered order belonging to its author — `createReview` refuses
              anything else — so a per-row badge would mark all of them and
              distinguish nothing. */}
          <p className="rvb-note">
            Every review here is written by a buyer against a delivered order.
          </p>
        </div>

        <ul className="rvb-feed">
          {list.map((r, i) => {
            const to = `/products/${r.group_id}`;
            // A group with one variant names that variant after itself, which
            // is most of this catalogue — so the chip printed the product's own
            // name a second time, immediately after it, on nearly every row.
            // The chip is here to say WHICH size or option was bought; when it
            // has nothing to add it is repetition wearing a border.
            const variant = r.variant_name && r.variant_name !== r.group_name ? r.variant_name : null;
            return (
              <li key={r.id} className="rvb-item" style={{ '--i': i }}>
                <article className="rvb-quote">
                  <header className="rvb-quote-head">
                    <Stars rating={r.rating} />
                    <time className="rvb-when" dateTime={r.created_at}>
                      {relTime(r.created_at, now)}
                    </time>
                    {r.signed && (
                      // Glow means verified here (DESIGN §3) and the wording
                      // carries the same meaning without it, so the mark still
                      // reads at `--glow-strength: 0`. It is only ever drawn on
                      // a signature the server verified against the author's
                      // key AND bound to this exact text.
                      <span className="rvb-signed" title="Signed with the reviewer's PGP key, and the signature covers this text">
                        <ShieldCheck size={11} strokeWidth={2.2} aria-hidden="true" />
                        Signed
                      </span>
                    )}
                  </header>

                  <p className="rvb-body">
                    {r.body}
                    {r.truncated && <span className="rvb-elide">…</span>}
                  </p>

                  <footer className="rvb-quote-foot">
                    {r.author && <span className="rvb-author">{r.author}</span>}
                    <Link className="rvb-product" to={to}>
                      <span className="rvb-product-name">{r.group_name}</span>
                      {variant && <span className="rvb-variant">{variant}</span>}
                      <ArrowRight size={12} aria-hidden="true" />
                    </Link>
                  </footer>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * What the storefront mounts: the band, once the store has said whether it has
 * one.
 *
 * No skeleton, for the reason the promises section has none — this sits below
 * the fold, so a placeholder only shifts the page under somebody who has not
 * scrolled to it, and a store with the band switched off should never reserve
 * space for it.
 */
export default function RecentReviews() {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api.get('/reviews/recent')
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { if (!cancelled) setData({ enabled: false, reviews: [] }); });
    return () => { cancelled = true; };
  }, []);

  if (!data?.enabled) return null;

  return (
    <ReviewsBand
      heading={data.heading}
      reviews={data.reviews}
      totalCount={data.total_count}
      averageRating={data.average_rating}
      distribution={data.distribution}
    />
  );
}
