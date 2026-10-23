import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  MessageSquare, Star, Eye, EyeOff, Trash2, ShieldCheck, BadgeCheck,
  ChevronDown, ChevronUp, Search, ArrowUpDown, ExternalLink, Package,
  Clock, Receipt, RefreshCw, Ban, AlertCircle, FilterX, Inbox, Flag, CheckCheck,
} from 'lucide-react';
import { api } from '../../utils/api';
import PageHeader from '../../components/admin/PageHeader';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import ReviewDigest from '../../components/admin/ai/ReviewDigest';

/**
 * Review moderation.
 *
 * DESIGN §6 asks every list which of three shapes it is. This one is TWO REAL
 * VIEWS — and it is worth saying why, because the queues either side of it
 * (`admin/Orders.jsx`, `admin/Products.jsx`) answered the same question with a
 * toggle that re-densifies one card component.
 *
 * A review is two jobs wearing one record. The moderation CARD is evidence:
 * product media, five stars, and a body that routinely runs to paragraphs and
 * has to be read in full before anyone decides anything. The moderation QUEUE
 * is a work list: forty reviews, one line each, scanned down the rating column
 * and cleared with hide/delete without reading much at all. Compressing the
 * card until it is short enough to be a line costs it the media and the prose,
 * which is the entire evidence; stretching the line back out to carry them
 * just rebuilds the card. Neither shape is the other at a different density,
 * so both are drawn and they share only the record and the two actions.
 *
 * The switch is still `ViewToggle` + `useViewMode`, because the choice is the
 * operator's and has to survive a navigation — see `hooks/useViewMode.js` for
 * why every surface goes through the one module rather than its own useState.
 *
 * Nothing is dropped on the way to the line. §5 is explicit that the compact
 * view is not the roomy one with columns deleted, so the row re-flows the
 * card's fields instead of editing them down: the body truncates behind a
 * click that opens it in place, the five badges become icon chips that keep
 * their words for a screen reader, and reviewer/date and order/status each
 * share one stacked cell.
 */

const LIMIT = 24;

/* The stagger ladder is capped so the last card on a full page does not wait
   most of a second to appear — the same cap admin/Orders.jsx applies. */
const STAGGER_CAP = 9;

const VISIBILITY = [
  { key: 'all', label: 'All' },
  { key: 'visible', label: 'Visible' },
  { key: 'hidden', label: 'Hidden' },
];

/* Mirrors the server's REVIEW_SORTS whitelist. An unknown key falls back to
   `newest` server-side, so a stale bookmark degrades instead of erroring. */
const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'highest', label: 'Highest rated' },
  { key: 'lowest', label: 'Lowest rated' },
];

/* Rating drives the card's accent rail and its score colour. Two stars or
   fewer is what a moderator is usually hunting for, so it reads as danger. */
function toneFor(rating) {
  if (rating <= 2) return 'var(--danger)';
  if (rating === 3) return 'var(--warning)';
  return 'var(--success)';
}

function relativeDate(value) {
  if (!value) return '—';
  const then = new Date(value);
  if (Number.isNaN(then.getTime())) return '—';
  const mins = Math.round((Date.now() - then.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return then.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function fullDate(value) {
  if (!value) return 'Unknown date';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleString();
}

function Stars({ rating, size = 13 }) {
  return (
    <span className="arv-stars" role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          size={size}
          aria-hidden="true"
          className={`arv-star${n <= rating ? ' is-on' : ''}`}
          fill={n <= rating ? 'currentColor' : 'none'}
        />
      ))}
    </span>
  );
}

/* The reviewer's provenance, as one hover string. Hoisted out of the card so
   the queue row cannot answer "who is this" differently from the card for the
   same account — the two views are separate renderings, and a fact stated
   twice in two places is a fact that will eventually disagree with itself. */
function reviewerTitleFor(review) {
  return [
    review.username ? `@${review.username}` : 'Account deleted',
    review.user_joined_at ? `joined ${fullDate(review.user_joined_at)}` : null,
    review.user_has_pgp ? 'account has a PGP key' : null,
    review.user_active === false ? 'account deactivated' : null,
  ].filter(Boolean).join(' · ');
}

/* The product's display name, with the same fallback ladder in both views. */
function productNameFor(review) {
  return review.product_name
    || review.group_name
    || `Product #${review.product_id ?? review.group_id}`;
}

/* Windowed pager: 1 … 4 5 6 … 12. Keeps the control a fixed width however many
   pages there are, instead of growing a row of 40 buttons. */
function pageWindow(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const out = new Set([1, totalPages, page, page - 1, page + 1]);
  const nums = [...out].filter(n => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const withGaps = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1] > 1) withGaps.push(`gap-${n}`);
    withGaps.push(n);
  });
  return withGaps;
}

/**
 * Is this review still waiting on somebody's judgement?
 *
 * Flagged by rule, still visible, and either never ruled on or edited since it
 * was — the exact population `opsFacts.reviews_flagged_unmoderated` counts, so
 * the button appears on precisely the rows that number is about. A hidden
 * review is already decided; an unflagged one was never in the queue.
 *
 * The edited-since arm matters and is easy to drop: a buyer can rewrite a
 * review after it was cleared, with a phone number in it the second time, and
 * a plain "has it been moderated" test would never show it again.
 */
function needsRuling(review) {
  if (review.hidden) return false;
  if (!(review.flags || []).length) return false;
  if (!review.moderated_at) return true;
  const changed = review.updated_at || review.created_at;
  return Boolean(changed) && new Date(changed) > new Date(review.moderated_at);
}

function ReviewCard({ review, index, busy, removing, onToggleHidden, onMarkChecked, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);

  const body = review.body || '';
  /* The clamp is applied only when this toggle is rendered, so no text can end
     up hidden with no way to reach it. */
  const isLong = body.length > 240 || body.split('\n').length > 5;
  const showImage = review.image_path && !imageBroken;

  const cardClass = [
    'glass-card',
    'arv-card',
    review.hidden ? 'is-hidden' : '',
    busy ? 'is-busy' : '',
    removing ? 'is-removing' : '',
  ].filter(Boolean).join(' ');

  const reviewerTitle = reviewerTitleFor(review);
  const productName = productNameFor(review);

  return (
    <article
      className={cardClass}
      style={{ '--arv-tone': toneFor(review.rating ?? 0), '--i': Math.min(index, STAGGER_CAP) }}
      aria-busy={busy || removing ? 'true' : undefined}
    >
      <span className="arv-rail" aria-hidden="true" />

      <div className="arv-head">
        <div className="arv-thumb">
          {showImage ? (
            <img
              src={review.image_path}
              alt=""
              loading="lazy"
              onError={() => setImageBroken(true)}
            />
          ) : (
            <Package size={18} aria-hidden="true" />
          )}
        </div>

        <div className="arv-titles">
          <Link
            className="arv-product"
            to={`/products/${review.product_id ?? review.group_id}`}
            title={`Open ${productName} in the storefront`}
          >
            <span>{productName}</span>
            <ExternalLink size={12} aria-hidden="true" />
          </Link>
          {review.variant_name && <div className="arv-variant">{review.variant_name}</div>}
        </div>

        <div className="arv-rating">
          <Stars rating={review.rating ?? 0} />
          <span className="arv-score">{review.rating ?? 0}</span>
        </div>
      </div>

      <div className="arv-meta">
        {/* §9: a field that names another record is a link. The reviewer was a
            dead end here — the next question after "is this review real" is
            always "what else has this account done", and that answer lives on
            the Users page. A deleted account has no row to open, so it stays
            plain text rather than becoming a link to nothing. */}
        <span className="arv-who" title={reviewerTitle}>
          {review.username
            ? (review.user_id
              ? <Link className="arv-who-link" to={`/admin/users?id=${review.user_id}`}><b>{review.username}</b></Link>
              : <b>{review.username}</b>)
            : <span className="arv-anon">Account deleted</span>}
        </span>
        <span className="arv-dot" aria-hidden="true" />
        <span className="arv-when" title={fullDate(review.created_at)}>
          <Clock size={11} aria-hidden="true" />
          {relativeDate(review.created_at)}
        </span>
      </div>

      {body ? (
        <>
          <p className={`arv-body${isLong && !expanded ? ' is-clamped' : ''}`}>{body}</p>
          {isLong && (
            <button
              type="button"
              className="arv-more"
              onClick={() => setExpanded(v => !v)}
              aria-expanded={expanded}
            >
              {expanded
                ? <><ChevronUp size={12} aria-hidden="true" /> Show less</>
                : <><ChevronDown size={12} aria-hidden="true" /> Show more</>}
            </button>
          )}
        </>
      ) : (
        <p className="arv-body-empty">Rating only — no written review.</p>
      )}

      <div className="arv-tags">
        {review.hidden && (
          <span className="arv-tag is-hidden-flag">
            <EyeOff size={10} aria-hidden="true" /> Hidden
          </span>
        )}
        {review.verified ? (
          <span className="arv-tag is-verified" title="Left against a delivered order the reviewer owns">
            <BadgeCheck size={10} aria-hidden="true" /> Verified
          </span>
        ) : (
          <span className="arv-tag" title="No surviving order linkage — the order row was deleted">
            <AlertCircle size={10} aria-hidden="true" /> Unlinked
          </span>
        )}
        {review.pgp_signed && (
          <span className="arv-tag is-signed" title="Submitted with a PGP signature">
            <ShieldCheck size={10} aria-hidden="true" /> PGP signed
          </span>
        )}
        {review.user_active === false && (
          <span className="arv-tag is-banned" title="The reviewer's account is deactivated">
            <Ban size={10} aria-hidden="true" /> Account off
          </span>
        )}
        {review.user_role && review.user_role !== 'user' && (
          <span className="arv-tag">{review.user_role}</span>
        )}
        {/* What in the body a moderator should read first, found by rule
            (server/services/reviewFlags.js). The title carries the matched
            text so the chip can be checked without re-reading the paragraph.
            A flag asks for a look, never a verdict. */}
        {(review.flags || []).map((f) => (
          <span key={f.kind} className="arv-tag is-leak" title={`${f.label}: “${f.sample}”`}>
            <Flag size={10} aria-hidden="true" /> {f.label}
          </span>
        ))}
      </div>

      {review.order_uuid && (
        <div className="arv-order">
          <Receipt size={12} aria-hidden="true" />
          <code title={review.order_uuid}>{review.order_uuid.slice(0, 8)}</code>
          <span className={`arv-order-status status-${review.order_status || 'pending'}`}>
            {(review.order_status || 'unknown').replace(/_/g, ' ')}
          </span>
        </div>
      )}

      <div className="arv-actions">
        <button
          type="button"
          className={`glass-btn glass-btn-sm${review.hidden ? ' glass-btn-success' : ''}`}
          onClick={() => onToggleHidden(review)}
          disabled={busy || removing}
          title={review.hidden ? 'Hidden from customers — click to restore' : 'Visible to customers — click to hide'}
        >
          {review.hidden
            ? <><Eye size={13} aria-hidden="true" /> Restore</>
            : <><EyeOff size={13} aria-hidden="true" /> Hide</>}
        </button>
        {/* Only on a flagged review that is still visible and not yet ruled on.
            On anything else it would be a button that does nothing a reader
            could see: a hidden review is already decided, and an unflagged one
            was never in the queue. */}
        {needsRuling(review) && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => onMarkChecked(review)}
            disabled={busy || removing}
            title="You have read it and it can stay — clears it from the flagged queue without hiding anything"
          >
            <CheckCheck size={13} aria-hidden="true" /> Looks fine
          </button>
        )}
        <span className="arv-actions-spacer" />
        <button
          type="button"
          className="glass-btn glass-btn-sm glass-btn-danger"
          onClick={() => onDelete(review)}
          disabled={busy || removing}
          title="Delete this review permanently"
        >
          <Trash2 size={13} aria-hidden="true" /> Delete
        </button>
      </div>
    </article>
  );
}

/* The queue's column headings, declared once so the head row and the tracks in
   51-admin-reviews.css cannot drift apart — seven labels over seven tracks,
   and a mismatch prints every heading one column left of its data. */
const ROW_COLUMNS = [
  { label: 'Product' },
  { label: 'Rating' },
  { label: 'Review', className: 'arv-head-body' },
  { label: 'Reviewer' },
  { label: 'Order' },
  { label: 'Flags', className: 'arv-head-flags' },
  { label: 'Moderate', className: 'arv-head-actions' },
];

/**
 * One review as a line in the moderation queue.
 *
 * Not the card at a smaller size — see the §6 note at the top of this file for
 * why the two are drawn separately. What changes here is that the body stops
 * being the point of the record and becomes one truncated column among seven,
 * because in this view the moderator is deciding from the rating, the badges
 * and the order linkage and only opening the prose for the ones that look
 * wrong.
 *
 * Truncated is not discarded: the whole body is in the DOM inside the button
 * (the clipping is CSS), the `title` gives a pointer a peek, and a click opens
 * it in place. A row that showed the first forty characters with no way to
 * reach the rest would be asking someone to moderate text they cannot read.
 */
function ReviewRow({ review, busy, removing, onToggleHidden, onMarkChecked, onDelete }) {
  const [open, setOpen] = useState(false);

  const body = review.body || '';
  const productName = productNameFor(review);
  const reviewerTitle = reviewerTitleFor(review);

  /* The tooltip is the glance; the expander is the full text. Capped, because
     an unbounded `title` on a five-paragraph review paints a slab over the
     rows underneath it that cannot be scrolled, selected or dismissed. */
  const peek = body.length > 320 ? `${body.slice(0, 320)}…` : body;

  const rowClass = [
    'lrow',
    'arv-row',
    review.hidden ? 'is-off' : '',
    busy || removing ? 'is-busy' : '',
    removing ? 'is-going' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      /* `--lrow-tone` is the rating, exactly as the card's rail is, so the same
         review is the same colour whichever view an operator has chosen.
         The shared `.lrow.is-urgent` is deliberately unused: it means "this
         row needs somebody to act", and every row in a moderation queue does.
         A marker that lights everything is a marker that says nothing. */
      className={rowClass}
      style={{ '--lrow-tone': toneFor(review.rating ?? 0) }}
      aria-busy={busy || removing ? 'true' : undefined}
    >
      <div className="lrow-stack">
        <Link
          className="lrow-text arv-row-product"
          to={`/products/${review.product_id ?? review.group_id}`}
          title={`Open ${productName} in the storefront`}
        >
          {productName}
        </Link>
        <small>{review.variant_name || 'No variant'}</small>
      </div>

      <div className="arv-row-rating">
        <Stars rating={review.rating ?? 0} size={11} />
        <span className="lrow-num arv-row-score">{review.rating ?? 0}</span>
      </div>

      {body ? (
        <button
          type="button"
          className="arv-row-body lrow-wrap"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          title={peek}
        >
          <span className="lrow-text">{body}</span>
          {open
            ? <ChevronUp size={12} aria-hidden="true" />
            : <ChevronDown size={12} aria-hidden="true" />}
        </button>
      ) : (
        <span className="arv-row-body-empty lrow-wrap lrow-text">Rating only — no written review.</span>
      )}

      <div className="lrow-stack">
        {review.username ? (
          review.user_id ? (
            <Link className="lrow-text arv-row-user" to={`/admin/users?id=${review.user_id}`} title={reviewerTitle}>
              {review.username}
            </Link>
          ) : (
            <span className="lrow-text" title={reviewerTitle}>{review.username}</span>
          )
        ) : (
          <span className="lrow-text arv-anon" title={reviewerTitle}>Account deleted</span>
        )}
        <small title={fullDate(review.created_at)}>{relativeDate(review.created_at)}</small>
      </div>

      <div className="lrow-stack arv-row-order">
        {review.order_uuid ? (
          <Link
            className="lrow-id"
            to={`/admin/orders?search=${encodeURIComponent(review.order_uuid)}`}
            title={`Open order ${review.order_uuid} in the order queue`}
          >
            {review.order_uuid.slice(0, 8)}
          </Link>
        ) : (
          <span className="lrow-id arv-row-noorder" title="The order row was deleted — nothing links this review to a purchase">
            none
          </span>
        )}
        <span className={`arv-row-ostatus${review.order_status ? ` status-${review.order_status}` : ' is-none'}`}>
          {(review.order_status || 'unlinked').replace(/_/g, ' ')}
        </span>
      </div>

      {/* The card's five badges, at chip size. Each keeps its word for a screen
          reader rather than being an icon and nothing else — an operator on a
          reader would otherwise get five unlabelled images per row, and these
          badges are the whole of why a review gets hidden. */}
      <div className="arv-row-flags lrow-wrap">
        {review.hidden && (
          <span className="arv-flag is-hidden-flag" title="Hidden from customers">
            <EyeOff size={11} aria-hidden="true" /><span className="sr-only">Hidden</span>
          </span>
        )}
        {review.verified ? (
          <span className="arv-flag is-verified" title="Left against a delivered order the reviewer owns">
            <BadgeCheck size={11} aria-hidden="true" /><span className="sr-only">Verified</span>
          </span>
        ) : (
          <span className="arv-flag is-unlinked" title="No surviving order linkage — the order row was deleted">
            <AlertCircle size={11} aria-hidden="true" /><span className="sr-only">Unlinked</span>
          </span>
        )}
        {review.pgp_signed && (
          <span className="arv-flag is-signed" title="Submitted with a PGP signature">
            <ShieldCheck size={11} aria-hidden="true" /><span className="sr-only">PGP signed</span>
          </span>
        )}
        {review.user_active === false && (
          <span className="arv-flag is-banned" title="The reviewer's account is deactivated">
            <Ban size={11} aria-hidden="true" /><span className="sr-only">Account off</span>
          </span>
        )}
        {review.user_role && review.user_role !== 'user' && (
          <span className="arv-flag arv-flag-role" title={`Reviewer's role: ${review.user_role}`}>
            {review.user_role}
          </span>
        )}
        {(review.flags || []).map((f) => (
          <span key={f.kind} className="arv-flag is-leak" title={`${f.label}: “${f.sample}”`}>
            <Flag size={11} aria-hidden="true" /><span className="sr-only">{f.label}</span>
          </span>
        ))}
      </div>

      {/* Two actions, not two identical buttons: hiding is the routine move and
          keeps its word, deleting is irreversible and is an icon with a label
          for anything that cannot see it — §1's rule about a row with one
          dangerous action and several routine ones. */}
      <div className="lrow-actions">
        <button
          type="button"
          className={`glass-btn glass-btn-sm${review.hidden ? ' glass-btn-success' : ''}`}
          onClick={() => onToggleHidden(review)}
          disabled={busy || removing}
          title={review.hidden ? 'Hidden from customers — click to restore' : 'Visible to customers — click to hide'}
        >
          {review.hidden
            ? <><Eye size={12} aria-hidden="true" /> Restore</>
            : <><EyeOff size={12} aria-hidden="true" /> Hide</>}
        </button>
        {needsRuling(review) && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => onMarkChecked(review)}
            disabled={busy || removing}
            title="You have read it and it can stay — clears it from the flagged queue without hiding anything"
          >
            <CheckCheck size={12} aria-hidden="true" /> Looks fine
          </button>
        )}
        <button
          type="button"
          className="glass-btn glass-btn-sm glass-btn-danger arv-row-delete"
          onClick={() => onDelete(review)}
          disabled={busy || removing}
          title="Delete this review permanently"
          aria-label={`Delete the review of ${productName} permanently`}
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      </div>

      {open && body && (
        /* `aria-hidden`, because the button above already carries the entire
           body as its accessible name — without this a screen reader reads the
           review twice, once on the control and once on the panel it opened.
           This copy is the sighted half of the same disclosure. */
        <p className="arv-row-full" aria-hidden="true">{body}</p>
      )}
    </div>
  );
}

export default function Reviews() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState(null);
  const [ratingCounts, setRatingCounts] = useState(null);

  const [visibility, setVisibility] = useState('all');
  const [ratings, setRatings] = useState([]);
  /* Only the reviews the rules flagged — a link, a handle, a number, an
     address. Filtered on the server so the count is the whole queue's. */
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState('newest');
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');

  const [busyIds, setBusyIds] = useState(() => new Set());
  const [removingIds, setRemovingIds] = useState(() => new Set());

  /* Evidence cards or the moderation queue, remembered per operator. The two
     are separate renderings (see the §6 note at the top), so this picks a
     component rather than a density class. */
  const [view, setView] = useViewMode('admin-reviews');
  const isRows = view === 'rows';

  /* Guards against a slow request landing on top of a fast one — every filter
     keystroke starts a fetch, so out-of-order responses are not theoretical. */
  const seqRef = useRef(0);

  const ratingKey = ratings.join(',');

  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const seq = ++seqRef.current;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), sort });
      if (visibility === 'visible') params.set('hidden', 'false');
      if (visibility === 'hidden') params.set('hidden', 'true');
      if (ratingKey) params.set('rating', ratingKey);
      if (query) params.set('q', query);
      if (flaggedOnly) params.set('flagged', '1');

      const data = await api.get(`/moderation/reviews?${params}`);
      if (seq !== seqRef.current) return;

      /* Deleting the last row of the last page would otherwise strand the
         operator on an empty page with a live "Page 4 of 3" counter. */
      const lastPage = Math.max(1, Math.ceil((data.total ?? 0) / LIMIT));
      if (page > lastPage) {
        setPage(lastPage);
        return;
      }

      setReviews(data.reviews || []);
      setTotal(data.total ?? 0);
      setCounts(data.counts || null);
      setRatingCounts(data.rating_counts || null);
      setBusyIds(new Set());
      setRemovingIds(new Set());
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err.message || 'Failed to load reviews');
      toast.error(err.message || 'Failed to load reviews');
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [page, visibility, ratingKey, sort, query, flaggedOnly]);

  useEffect(() => { load(); }, [load]);

  const resetTo = (fn) => { fn(); setPage(1); };

  const toggleRating = (n) => resetTo(() => {
    setRatings(prev => (prev.includes(n) ? prev.filter(v => v !== n) : [...prev, n].sort((a, b) => b - a)));
  });

  const clearFilters = () => resetTo(() => {
    setVisibility('all');
    setRatings([]);
    setFlaggedOnly(false);
    setSearchInput('');
    setQuery('');
  });

  const markBusy = (id, on) => setBusyIds(prev => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  /**
   * "I read it, it is fine" — a decision that changes nothing visible.
   *
   * ── Why this button had to exist ──────────────────────────────────────────
   *
   * `services/reviewFlags.js` is explicit that a flag "says look at this, never
   * hide this", and the usual right answer to a flagged review is to keep it.
   * There was no way to record that: Hide was the only action, so a moderator
   * who read a flagged review and decided it was fine left the page exactly as
   * they found it and met the same row tomorrow.
   *
   * That was survivable while the flagged pill was a filter somebody chose to
   * press. It stopped being survivable when the count became an ops fact with
   * a threshold on it (`opsFacts.reviews_flagged_unmoderated`), because a count
   * that can only rise produces an alert every morning about work already done.
   *
   * Nothing about the review changes — it was visible and stays visible. What
   * changes is that the shop now knows somebody looked, until the buyer edits
   * it, at which point it is new text and comes back.
   */
  const markChecked = async (review) => {
    markBusy(review.id, true);
    // Not optimistic, unlike the hide toggle: there is nothing on the card to
    // flip. The state this writes is only visible through the flagged count,
    // which the refetch below brings back.
    try {
      await api.put(`/moderation/reviews/${review.id}`, { cleared: true });
      toast.success('Marked as checked — it stays visible');
      await load({ quiet: true });
    } catch (err) {
      toast.error(err.message || 'Failed to update review');
    } finally {
      markBusy(review.id, false);
    }
  };

  const toggleHidden = async (review) => {
    const next = !review.hidden;
    markBusy(review.id, true);
    // Optimistic: flip locally first so the badge and the rail change under the
    // cursor, then reconcile with a quiet refetch (which the facet counts need
    // anyway). A failure puts the old value back.
    setReviews(list => list.map(r => (r.id === review.id ? { ...r, hidden: next } : r)));
    try {
      await api.put(`/moderation/reviews/${review.id}`, { hidden: next });
      toast.success(next ? 'Review hidden from customers' : 'Review is visible again');
      await load({ quiet: true });
    } catch (err) {
      setReviews(list => list.map(r => (r.id === review.id ? { ...r, hidden: !next } : r)));
      toast.error(err.message || 'Failed to update review');
    } finally {
      // `load` clears the whole set, but it can bail early when a newer request
      // has superseded it — without this the card would stay disabled forever.
      markBusy(review.id, false);
    }
  };

  const deleteReview = async (review) => {
    if (!window.confirm('Delete this review permanently? This cannot be undone.')) return;
    setRemovingIds(prev => new Set(prev).add(review.id));
    try {
      await api.delete(`/reviews/${review.id}`);
      toast.success('Review deleted');
      await load({ quiet: true });
    } catch (err) {
      setRemovingIds(prev => {
        const next = new Set(prev);
        next.delete(review.id);
        return next;
      });
      toast.error(err.message || 'Failed to delete review');
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const isFiltered = visibility !== 'all' || ratings.length > 0 || query !== '';
  const visibilityCounts = {
    all: counts?.all ?? 0,
    visible: counts?.visible ?? 0,
    hidden: counts?.hidden ?? 0,
  };

  const subtitle = useMemo(() => {
    if (error) return 'Could not reach the moderation queue.';
    if (!counts) return 'Loading the moderation queue…';
    if (counts.all === 0) {
      return isFiltered ? 'Nothing matches the current filters.' : 'No reviews submitted yet.';
    }
    const scope = isFiltered ? 'matching' : 'in total';
    return `${counts.hidden} hidden of ${counts.all} ${scope} · showing ${reviews.length} on page ${page} of ${totalPages}`;
  }, [error, counts, isFiltered, reviews.length, page, totalPages]);

  /* One empty state, two frames.
     §9: an empty list is navigation, not an apology — and the two places a
     moderator goes from an empty queue are real ones. A review can only exist
     against a delivered order, so "no reviews yet" is usually answered by the
     delivered orders, and the catalogue is where a product with no reviews at
     all is looked at. Written once because the sentence is the same whichever
     view is on screen, and two copies would be two sentences by the next
     release. */
  const emptyTitle = isFiltered ? 'Nothing matches those filters' : 'No reviews yet';
  const emptyDetail = isFiltered
    ? 'No review matches this combination of visibility, rating and search. Widen the filters to see the rest of the queue.'
    : 'A customer can review an item once an order containing it has been delivered. The first one lands here for moderation.';
  const emptyLinks = (
    <>
      {isFiltered && (
        <button type="button" className="glass-btn glass-btn-sm" onClick={clearFilters}>
          <FilterX size={13} aria-hidden="true" /> Clear filters
        </button>
      )}
      <Link className="glass-btn glass-btn-sm" to="/admin/orders?status=delivered">
        <Receipt size={13} aria-hidden="true" /> Delivered orders
      </Link>
      <Link className="glass-btn glass-btn-sm" to="/admin/products">
        <Package size={13} aria-hidden="true" /> Catalogue
      </Link>
    </>
  );

  const queueHead = (
    <div className="lrows-head">
      {ROW_COLUMNS.map(col => (
        <span key={col.label} className={col.className}>{col.label}</span>
      ))}
    </div>
  );

  return (
    <div className="admin-page">
      <PageHeader icon={MessageSquare} title="Reviews" subtitle={subtitle}>
        <button
          type="button"
          className="glass-btn"
          onClick={() => load({ quiet: true })}
          disabled={loading || refreshing}
        >
          {refreshing
            ? <><span className="spinner spinner-inline" /> Refreshing…</>
            : <><RefreshCw size={14} aria-hidden="true" /> Refresh</>}
        </button>
      </PageHeader>

      <div className="admin-toolbar is-sticky">
        <div className="status-filter-row" role="group" aria-label="Filter reviews by visibility">
          {VISIBILITY.map(f => (
            <button
              key={f.key}
              type="button"
              className={`status-filter-pill${visibility === f.key ? ' active' : ''}`}
              onClick={() => resetTo(() => setVisibility(f.key))}
              aria-pressed={visibility === f.key}
            >
              {f.label}
              <span className="status-filter-count">{visibilityCounts[f.key]}</span>
            </button>
          ))}
          {/* Its own pill rather than a fourth visibility state: flagged is a
              property of the text, and a moderator wants "flagged AND hidden"
              as much as "flagged AND visible". */}
          <button
            type="button"
            className={`status-filter-pill${flaggedOnly ? ' active' : ''}`}
            onClick={() => resetTo(() => setFlaggedOnly((v) => !v))}
            aria-pressed={flaggedOnly}
            title="Reviews carrying a link, a contact handle, a phone number or an address"
          >
            <Flag size={10} aria-hidden="true" /> Flagged
            <span className="status-filter-count">{counts?.flagged ?? 0}</span>
          </button>
        </div>

        <div className="admin-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            placeholder="Search text, reviewer or product…"
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setPage(1); }}
            aria-label="Search review text, reviewer name or product name"
          />
        </div>
      </div>

      {/* One product's reviews, read together. Rendered from the reviews on
          this page, so it disappears with an empty queue and follows the
          filters. Read-only: components/admin/ai/ReviewDigest. */}
      <ReviewDigest reviews={reviews} />

      <div className="arv-subbar">
        <div className="status-filter-row" role="group" aria-label="Filter reviews by rating">
          <button
            type="button"
            className={`status-filter-pill${ratings.length === 0 ? ' active' : ''}`}
            onClick={() => resetTo(() => setRatings([]))}
            aria-pressed={ratings.length === 0}
          >
            Any rating
          </button>
          {[5, 4, 3, 2, 1].map(n => (
            <button
              key={n}
              type="button"
              className={`status-filter-pill arv-rating-pill${ratings.includes(n) ? ' active' : ''}`}
              onClick={() => toggleRating(n)}
              aria-pressed={ratings.includes(n)}
              aria-label={`${n} star reviews, ${ratingCounts?.[n] ?? 0} matching`}
            >
              <Star size={10} fill="currentColor" aria-hidden="true" />
              {n}
              <span className="status-filter-count">{ratingCounts?.[n] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="arv-subbar-tools">
          <div className="arv-sort">
            <ArrowUpDown size={14} aria-hidden="true" />
            <select
              className="glass-input"
              value={sort}
              onChange={(e) => resetTo(() => setSort(e.target.value))}
              aria-label="Sort reviews"
            >
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>

          {/* "Queue" rather than the shared default "Rows": the compact half of
              this surface is not the same list at a smaller size, it is the
              work list, and the word on the control should say which of the
              two things the operator is asking for. */}
          <ViewToggle
            value={view}
            onChange={setView}
            label="Review layout"
            cardsLabel="Cards"
            rowsLabel="Queue"
          />
        </div>
      </div>

      {visibility === 'hidden' && (
        <div className="arv-note">
          <EyeOff size={14} aria-hidden="true" />
          Hidden reviews stay in the database and still count toward the product&apos;s history, but customers never see them.
        </div>
      )}

      {loading ? (
        /* The skeleton matches the view that is about to arrive. Loading a
           card grid and then replacing it with a seven-column queue is a
           layout jump the operator has to re-read from the top. */
        isRows ? (
          <div className="lrows arv-rows" aria-busy="true" aria-label="Loading the moderation queue">
            {queueHead}
            {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
              <div key={i} className="skeleton lrow-skel" />
            ))}
          </div>
        ) : (
          <div className="arv-grid" aria-busy="true" aria-label="Loading reviews">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="skeleton arv-skel" style={{ '--i': i }} />
            ))}
          </div>
        )
      ) : error ? (
        <div className="glass-card empty-state is-error">
          <AlertCircle size={34} aria-hidden="true" />
          <h3>The queue would not load</h3>
          <p>{error}</p>
          <button type="button" className="glass-btn" onClick={() => load()}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : reviews.length === 0 ? (
        /* The queue keeps its frame when it is empty — the list has to look
           like a list with nothing in it, not like the page lost a section. */
        isRows ? (
          <div className="lrows arv-rows">
            <div className="lrows-empty">
              <strong>{emptyTitle}</strong>
              {emptyDetail}
              <div className="lrows-empty-links">{emptyLinks}</div>
            </div>
          </div>
        ) : (
          <div className="glass-card empty-state">
            {isFiltered ? <FilterX size={34} aria-hidden="true" /> : <Inbox size={34} aria-hidden="true" />}
            <h3>{emptyTitle}</h3>
            <p>{emptyDetail}</p>
            <div className="arv-empty-links">{emptyLinks}</div>
          </div>
        )
      ) : isRows ? (
        <div className="lrows arv-rows">
          {queueHead}
          {reviews.map(review => (
            <ReviewRow
              key={review.id}
              review={review}
              busy={busyIds.has(review.id)}
              removing={removingIds.has(review.id)}
              onToggleHidden={toggleHidden}
              onMarkChecked={markChecked}
              onDelete={deleteReview}
            />
          ))}
        </div>
      ) : (
        <div className="arv-grid">
          {reviews.map((review, i) => (
            <ReviewCard
              key={review.id}
              review={review}
              index={i}
              busy={busyIds.has(review.id)}
              removing={removingIds.has(review.id)}
              onToggleHidden={toggleHidden}
              onMarkChecked={markChecked}
              onDelete={deleteReview}
            />
          ))}
        </div>
      )}

      {!loading && !error && totalPages > 1 && (
        <nav className="arv-pager" aria-label="Review pages">
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
          >
            Prev
          </button>

          {pageWindow(page, totalPages).map(entry => (
            typeof entry === 'number' ? (
              <button
                key={entry}
                type="button"
                className={`glass-btn glass-btn-sm arv-pager-num${entry === page ? ' glass-btn-active' : ''}`}
                onClick={() => setPage(entry)}
                aria-current={entry === page ? 'page' : undefined}
              >
                {entry}
              </button>
            ) : (
              <span key={entry} className="arv-pager-gap" aria-hidden="true">…</span>
            )
          ))}

          <button
            type="button"
            className="glass-btn glass-btn-sm"
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
          >
            Next
          </button>

          <span className="arv-pager-total">
            {total} review{total === 1 ? '' : 's'} across {totalPages} pages
          </span>
        </nav>
      )}
    </div>
  );
}
