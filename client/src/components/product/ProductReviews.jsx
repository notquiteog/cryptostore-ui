import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ChevronDown, Film, LogIn, MessageSquarePlus, Package, PenLine,
  ShieldCheck, Star, Trash2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import StarRating from '../StarRating';
import MediaLightbox from './MediaLightbox';
import ReviewMediaPicker from './ReviewMediaPicker';

const PAGE = 6;

const SORTS = {
  recent: { label: 'Most recent', cmp: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  highest: { label: 'Highest rated', cmp: (a, b) => b.rating - a.rating || new Date(b.created_at) - new Date(a.created_at) },
  lowest: { label: 'Lowest rated', cmp: (a, b) => a.rating - b.rating || new Date(b.created_at) - new Date(a.created_at) },
};

function initials(name) {
  return (name || '?').trim().slice(0, 2).toUpperCase();
}

/** Seconds → "0:07", for the badge on a clip's thumbnail. */
function clipLength(ms) {
  if (!ms || ms < 1000) return null;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** "3d ago" reads faster than a date when scanning a wall of cards. */
function relativeDate(value) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function ProductReviews({ variants = [], user, reviews = [], average, onReload, mediaEnabled = false }) {
  const [filter, setFilter] = useState(0); // 0 = every rating
  const [sort, setSort] = useState('recent');
  const [shown, setShown] = useState(PAGE);
  const [eligible, setEligible] = useState(null); // null = not loaded yet
  const [form, setForm] = useState({ rating: 5, body: '', choice: '', signature: '' });
  const [signing, setSigning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [viewer, setViewer] = useState(null); // { items, index } while media is open

  const variantIds = useMemo(() => new Set(variants.map(v => v.id)), [variants]);

  const histogram = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0];
    for (const r of reviews) {
      const i = Math.round(r.rating) - 1;
      if (i >= 0 && i < 5) buckets[i] += 1;
    }
    return buckets;
  }, [reviews]);

  const positive = useMemo(() => {
    if (reviews.length === 0) return null;
    return Math.round((reviews.filter(r => r.rating >= 4).length / reviews.length) * 100);
  }, [reviews]);

  const visible = useMemo(() => {
    const list = filter ? reviews.filter(r => Math.round(r.rating) === filter) : [...reviews];
    return list.sort(SORTS[sort].cmp);
  }, [reviews, filter, sort]);

  useEffect(() => { setShown(PAGE); }, [filter, sort]);

  /*
   * Which delivered order the review is filed against.
   *
   * The server only accepts a review whose (order, variant) pair belongs to the
   * signed-in buyer and whose order reached `delivered`, so the eligible pairs
   * are resolved up front rather than letting someone write a review and meet a
   * 403 at the end of it. Loaded on mount now that the compose card is always
   * on screen: it has to know which of its states to render before the buyer
   * looks at it, not after they click something.
   *
   * The owner filter is not redundant. `GET /orders` returns *every* order to
   * staff, so without it an admin is offered other people's purchases as things
   * they could review — and the server, correctly, refuses them.
   */
  useEffect(() => {
    if (!user) { setEligible(null); return undefined; }
    if (eligible !== null) return undefined;
    let cancelled = false;
    api.get('/orders?status=delivered&limit=50')
      .then(data => {
        if (cancelled) return;
        const mine = new Set(
          reviews.filter(r => r.username === user.username).map(r => `${r.order_id}:${r.variant_id}`)
        );
        const options = [];
        for (const order of data.orders || []) {
          if (order.user_id !== user.id) continue;
          for (const item of order.items || []) {
            if (!variantIds.has(item.variant_id)) continue;
            const key = `${order.id}:${item.variant_id}`;
            if (mine.has(key) || options.some(o => o.key === key)) continue;
            options.push({
              key,
              orderId: order.id,
              variantId: item.variant_id,
              variantName: item.variant_name,
              date: order.created_at,
            });
          }
        }
        setEligible(options);
        setForm(f => ({ ...f, choice: options[0]?.key || '' }));
      })
      .catch(() => { if (!cancelled) setEligible([]); });
    return () => { cancelled = true; };
  }, [user, eligible, reviews, variantIds]);

  const submit = async (e) => {
    e.preventDefault();
    const picked = (eligible || []).find(o => o.key === form.choice);
    if (!picked) return toast.error('Pick which delivered order you are reviewing');
    if (signing && !form.signature.trim()) return toast.error('Paste your signed message, or turn signing off');
    if (signing && !form.body.trim()) return toast.error('A signed review needs a body for the signature to cover');
    setSubmitting(true);
    try {
      const created = await api.post('/reviews', {
        variant_id: picked.variantId,
        order_id: picked.orderId,
        rating: form.rating,
        body: form.body.trim() || undefined,
        pgp_signature: signing ? form.signature.trim() : undefined,
      });

      // Media is attached in a second call, because it hangs off a review that
      // has to exist first. Posting the text first also means a transcode that
      // fails costs the buyer their photos, never the words they wrote — the
      // review is already saved by then, and the toast says which half failed.
      const reviewId = created?.review?.id;
      if (pendingFiles.length > 0 && reviewId) {
        setUploading(true);
        try {
          const fd = new FormData();
          pendingFiles.forEach(f => fd.append('files', f));
          await api.upload(`/reviews/${reviewId}/media`, fd);
          toast.success('Review and media posted — thank you');
        } catch (mediaErr) {
          toast.error(`Review posted, but the media failed: ${mediaErr.message || 'upload error'}`);
        } finally {
          setUploading(false);
        }
      } else {
        toast.success('Review posted — thank you');
      }

      setForm({ rating: 5, body: '', choice: '', signature: '' });
      setPendingFiles([]);
      setSigning(false);
      setEligible(null); // the used (order, variant) pair is no longer offerable
      onReload?.();
    } catch (err) {
      toast.error(err.message || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  };

  const removeMedia = async (mediaId) => {
    if (!confirm('Remove this attachment? This cannot be undone.')) return;
    try {
      await api.delete(`/reviews/media/${mediaId}`);
      toast.success('Attachment removed');
      onReload?.();
    } catch (err) {
      toast.error(err.message || 'Failed to remove attachment');
    }
  };

  const avg = average != null ? Number(average) : null;
  const busy = submitting || uploading;
  const dirty = Boolean(form.body) || pendingFiles.length > 0 || signing;

  /** The compose card's four resting states, resolved in one place. */
  const composeState = !user ? 'guest'
    : eligible === null ? 'loading'
    : eligible.length === 0 ? 'ineligible'
    : 'ready';

  return (
    <section className="pd-section pd-reviews" id="reviews" data-reveal>
      <header className="pd-section-head">
        <h2><Star size={15} aria-hidden="true" /> Reviews</h2>
        {reviews.length > 0 && <span className="pd-section-count">{reviews.length}</span>}
        {reviews.length > 1 && (
          <label className="pd-sort">
            <span className="pd-sort-label">Sort</span>
            <select className="glass-input" value={sort} onChange={e => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </label>
        )}
      </header>

      {/* ── Score overview ── */}
      {reviews.length > 0 && (
        <div className="pd-rsummary">
          <div className="pd-rsummary-score">
            <span className="pd-rsummary-avg">{avg != null ? avg.toFixed(1) : '—'}</span>
            <StarRating rating={Math.round(avg || 0)} size={15} />
            <span className="pd-rsummary-count">
              {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}
              {positive != null && <> · {positive}% positive</>}
            </span>
          </div>

          <div className="pd-rsummary-bars">
            {[5, 4, 3, 2, 1].map(star => {
              const n = histogram[star - 1];
              const pct = reviews.length ? (n / reviews.length) * 100 : 0;
              const on = filter === star;
              return (
                <button
                  type="button"
                  key={star}
                  className={`pd-review-bar${on ? ' active' : ''}`}
                  onClick={() => setFilter(on ? 0 : star)}
                  disabled={n === 0 && !on}
                  aria-pressed={on}
                  aria-label={`${n} ${star}-star ${n === 1 ? 'review' : 'reviews'}`}
                >
                  <span className="pd-rb-label">{star}★</span>
                  <span className="pd-rb-track">
                    <span className="pd-rb-fill" style={{ '--pd-bar': `${pct}%` }} />
                  </span>
                  <span className="pd-rb-n">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="pd-rgrid">

        {/* ── Compose card. Always present, and always first: a buyer who has
              earned the right to review this should not have to find a button
              to discover it. ── */}
        <article className={`pd-rcard pd-rcard-compose${composeState === 'ready' ? ' is-ready' : ''}`}>
          <header className="pd-rcard-head">
            <span className="pd-rcard-icon"><PenLine size={15} aria-hidden="true" /></span>
            <div>
              <h3>Write a review</h3>
              <p>
                {composeState === 'ready'
                  ? 'You bought this — tell other buyers how it went.'
                  : 'Reviews come from buyers whose order was delivered.'}
              </p>
            </div>
          </header>

          {composeState === 'guest' && (
            <div className="pd-rcard-cta">
              <Link to="/login" className="glass-btn glass-btn-primary">
                <LogIn size={15} aria-hidden="true" /> Sign in to review
              </Link>
            </div>
          )}

          {composeState === 'loading' && (
            <p className="pd-muted-line">
              <span className="spinner" style={{ width: 13, height: 13 }} /> Checking your orders…
            </p>
          )}

          {composeState === 'ineligible' && (
            <div className="pd-rcard-cta">
              <p className="pd-muted-line" style={{ margin: 0 }}>
                <Package size={13} aria-hidden="true" />
                Once an order containing this is delivered, you can review it here.
              </p>
              <Link to="/orders" className="glass-btn glass-btn-sm">View your orders</Link>
            </div>
          )}

          {composeState === 'ready' && (
            <form className="pd-rform" onSubmit={submit}>
              <div className="pd-rform-top">
                <div className="pd-rform-field">
                  <span className="pd-form-label">Your rating</span>
                  <StarRating
                    rating={form.rating}
                    interactive
                    size={28}
                    onRate={n => setForm(f => ({ ...f, rating: n }))}
                  />
                </div>

                <div className="pd-rform-field">
                  <label className="pd-form-label" htmlFor="pd-review-order">Which purchase</label>
                  <select
                    id="pd-review-order"
                    className="glass-input"
                    value={form.choice}
                    onChange={e => setForm(f => ({ ...f, choice: e.target.value }))}
                    required
                  >
                    {eligible.map(o => (
                      <option key={o.key} value={o.key}>
                        Order #{o.orderId} · {o.variantName} · {new Date(o.date).toLocaleDateString()}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pd-rform-field">
                <label className="pd-form-label" htmlFor="pd-review-body">
                  Review <span className="pd-optional">optional</span>
                </label>
                <textarea
                  id="pd-review-body"
                  className="glass-input"
                  rows={3}
                  maxLength={2000}
                  placeholder="How was the product, the packaging, the delivery?"
                  value={form.body}
                  onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                />
                {form.body.length > 1800 && (
                  <span className="pd-hint">{2000 - form.body.length} characters left</span>
                )}
              </div>

              {mediaEnabled && (
                <ReviewMediaPicker files={pendingFiles} onChange={setPendingFiles} disabled={busy} />
              )}

              <label className="pd-switch-line">
                <input type="checkbox" checked={signing} onChange={e => setSigning(e.target.checked)} />
                <span>Sign this review with my PGP key</span>
              </label>

              {signing && (
                <div className="pd-rform-field">
                  <label className="pd-form-label" htmlFor="pd-review-sig">Clearsigned message</label>
                  <textarea
                    id="pd-review-sig"
                    className="glass-input pd-mono"
                    rows={5}
                    placeholder={'-----BEGIN PGP SIGNED MESSAGE-----'}
                    value={form.signature}
                    onChange={e => setForm(f => ({ ...f, signature: e.target.value }))}
                  />
                  <p className="pd-hint">
                    Clearsign exactly the review text above with the key on your profile.
                    The store verifies the signature covers that text before showing the badge.
                  </p>
                </div>
              )}

              <div className="pd-rform-actions">
                <button type="submit" className="glass-btn glass-btn-primary" disabled={busy}>
                  {busy
                    ? <><span className="spinner" style={{ width: 14, height: 14 }} />
                        {uploading ? 'Processing media…' : 'Posting…'}</>
                    : `Post review${pendingFiles.length ? ` with ${pendingFiles.length} file${pendingFiles.length > 1 ? 's' : ''}` : ''}`}
                </button>
                {dirty && (
                  <button
                    type="button"
                    className="glass-btn glass-btn-sm"
                    disabled={busy}
                    onClick={() => {
                      setForm(f => ({ ...f, body: '', signature: '', rating: 5 }));
                      setPendingFiles([]);
                      setSigning(false);
                    }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </form>
          )}
        </article>

        {/* ── Active star filter ── */}
        {filter > 0 && (
          <div className="pd-rfilter">
            <span>
              Showing {visible.length} {filter}-star {visible.length === 1 ? 'review' : 'reviews'}
            </span>
            <button type="button" className="pd-chip-btn" onClick={() => setFilter(0)}>Clear filter</button>
          </div>
        )}

        {/* ── The reviews themselves ── */}
        {reviews.length === 0 ? (
          <article className="pd-rcard pd-rcard-empty">
            <MessageSquarePlus size={24} aria-hidden="true" />
            <p>No reviews yet — the first one on this product will sit right here.</p>
          </article>
        ) : visible.length === 0 ? (
          <article className="pd-rcard pd-rcard-empty">
            <Star size={24} aria-hidden="true" />
            <p>No {filter}-star reviews yet.</p>
          </article>
        ) : visible.slice(0, shown).map(r => (
          <article key={r.id} className="pd-rcard pd-review">
            <header className="pd-review-head">
              <span className="pd-review-avatar" aria-hidden="true">{initials(r.username)}</span>
              <span className="pd-review-who">
                <span className="pd-review-name">
                  {r.username || 'Anonymous'}
                  {user?.username === r.username && <span className="pd-review-you">you</span>}
                </span>
                <time
                  className="pd-review-date"
                  dateTime={r.created_at}
                  title={new Date(r.created_at).toLocaleString()}
                >
                  {relativeDate(r.created_at)}
                </time>
              </span>
              <StarRating rating={r.rating} size={13} />
            </header>

            {(r.pgp_signature || r.variant_name) && (
              <div className="pd-review-tags">
                {r.pgp_signature && (
                  <span className="pd-pgp" title="Signed with the reviewer's PGP key and verified by the store">
                    <ShieldCheck size={11} aria-hidden="true" /> PGP verified
                  </span>
                )}
                {r.variant_name && <span className="pd-review-variant">{r.variant_name}</span>}
              </div>
            )}

            {r.body && <p className="pd-review-text">{r.body}</p>}

            {r.media?.length > 0 && (
              <ul className="pd-review-media">
                {r.media.map((m, i) => {
                  const items = r.media.map(x => ({
                    src: x.path,
                    isVideo: x.media_type === 'video',
                    poster: x.poster_path,
                  }));
                  const length = clipLength(m.duration_ms);
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        className="pd-review-media-btn"
                        onClick={() => setViewer({ items, index: i })}
                        aria-label={`Open ${m.media_type === 'video' ? 'video' : 'photo'} ${i + 1} from ${r.username || 'this review'}`}
                      >
                        <img
                          src={m.media_type === 'video' ? (m.poster_path || m.path) : m.path}
                          alt=""
                          loading="lazy"
                          /* The stored dimensions reserve the box before the
                             file loads, so a review with photos does not
                             reflow the list underneath it as they arrive. */
                          width={m.width || undefined}
                          height={m.height || undefined}
                        />
                        {m.media_type === 'video' && (
                          <span className="pd-review-media-badge">
                            <Film size={10} aria-hidden="true" />
                            {length || 'clip'}
                          </span>
                        )}
                      </button>
                      {user?.username === r.username && (
                        <button
                          type="button"
                          className="pd-review-media-x"
                          onClick={() => removeMedia(m.id)}
                          aria-label="Remove this attachment"
                          title="Remove this attachment"
                        >
                          <Trash2 size={11} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </article>
        ))}
      </div>

      {visible.length > shown && (
        <div className="pd-more-row">
          <button type="button" className="glass-btn pd-more" onClick={() => setShown(s => s + PAGE)}>
            Show {Math.min(PAGE, visible.length - shown)} more
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          <span className="pd-more-count">Showing {shown} of {visible.length}</span>
        </div>
      )}

      {viewer && (
        <MediaLightbox
          items={viewer.items}
          index={viewer.index}
          onIndex={(i) => setViewer(v => ({ ...v, index: i }))}
          onClose={() => setViewer(null)}
          label="Review media"
        />
      )}
    </section>
  );
}
