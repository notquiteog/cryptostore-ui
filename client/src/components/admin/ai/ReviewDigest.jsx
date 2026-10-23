import { useCallback, useEffect, useMemo, useState } from 'react';
import { PenLine, Quote, Store, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../../utils/api';
import DraftTool from './DraftTool';

/** Matches `reviewController.SUMMARY_MAX` and the migration's CHECK. */
const SUMMARY_MAX = 1200;

function formatDate(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * What reviewers say about one product, summed up for the moderation desk —
 * and, once a moderator has read it, put on the product page.
 *
 * ── The draft is still read-only; the page gets what a person approved ─────
 *
 * The digest (`/ai/reviews/:groupId/digest`) saves nothing, and `DraftTool`
 * renders it as prose with nothing to edit, for the reason docs/AI.md §7
 * gives: review bodies are written by people who profit from steering the
 * answer, and a paragraph a model wrote from them is what an injected review
 * is trying to get onto the product page. So the slip's one action does not
 * publish. It moves the text into the composer below, where the moderator
 * can fix a sentence, and the composer's own button is the only thing that
 * writes — `PUT /reviews/summary/:groupId`, text only. There is no path from
 * the model's output to the column that does not pass under a person's
 * cursor first, and a summary typed by hand goes through the same door.
 *
 * ── What the desk shows about the page ─────────────────────────────────────
 *
 * When the product already carries a summary, the strip says since when and
 * from how many reviews — the count the text was published against — and,
 * when the live visible count has moved on, says that too, because a
 * paragraph written over six reviews is a stale claim over forty. Edit loads
 * the current text into the composer; Remove clears the page.
 *
 * ── Which product ──────────────────────────────────────────────────────────
 *
 * The ones on this page. A moderator has already filtered the queue to the
 * thing they are looking at — a product, a rating, a word — so the products
 * whose reviews are on screen are the products worth summing up, and the
 * picker offers those rather than a search over the whole catalogue.
 */
export default function ReviewDigest({ reviews }) {
  const products = useMemo(() => {
    const by = new Map();
    for (const r of reviews ?? []) {
      const id = r.product_id ?? r.group_id;
      if (!id) continue;
      const cur = by.get(id) || { id, name: r.product_name || r.group_name || `Product ${id}`, count: 0 };
      cur.count += 1;
      by.set(id, cur);
    }
    return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [reviews]);

  const [groupId, setGroupId] = useState('');
  useEffect(() => {
    if (!products.length) return;
    if (!products.some((p) => String(p.id) === String(groupId))) setGroupId(String(products[0].id));
  }, [products, groupId]);

  // What is on the product page for the chosen product, and how many reviews
  // a buyer can read there now. Null until the read lands; the strip is
  // absent rather than briefly wrong.
  const [published, setPublished] = useState(null);
  // The editable step between a draft and the page. Null when closed.
  const [composer, setComposer] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadPublished = useCallback((id) => {
    if (!id) return;
    api.get(`/reviews/summary/${id}`)
      .then((d) => setPublished({ summary: d.summary ?? null, visible: Number(d.visible_count ?? 0) }))
      .catch(() => setPublished({ summary: null, visible: 0, unknown: true }));
  }, []);

  useEffect(() => {
    setPublished(null);
    setComposer(null);
    loadPublished(groupId);
  }, [groupId, loadPublished]);

  const publish = async () => {
    const text = (composer?.text ?? '').trim();
    if (!text || text.length > SUMMARY_MAX) return;
    setSaving(true);
    try {
      const d = await api.put(`/reviews/summary/${groupId}`, { text });
      setPublished((p) => ({ ...(p || { visible: 0 }), summary: d.summary ?? null }));
      setComposer(null);
      toast.success('On the product page');
    } catch (err) {
      toast.error(err.message || 'Failed to publish the summary');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Take the summary off the product page? Buyers will see the reviews only.')) return;
    try {
      await api.delete(`/reviews/summary/${groupId}`);
      setPublished((p) => ({ ...(p || { visible: 0 }), summary: null }));
      toast.success('Removed from the product page');
    } catch (err) {
      toast.error(err.message || 'Failed to remove the summary');
    }
  };

  if (!products.length || !groupId) return null;

  const current = published?.summary || null;
  const stale = current && published && !published.unknown && published.visible !== current.based_on;
  const draftLen = (composer?.text ?? '').trim().length;
  const over = draftLen > SUMMARY_MAX;

  return (
    <section className="glass-card arv-digest" aria-label="What reviewers say">
      <div className="arv-digest-row">
        <label htmlFor="arv-digest-product">What reviewers say about</label>
        <select
          id="arv-digest-product"
          className="glass-input"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
        >
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.name} — {p.count} on this page</option>
          ))}
        </select>
        <DraftTool
          capability="reviews"
          icon={Quote}
          label="Digest the reviews"
          hint="Reads this product's review text, visible and hidden, and never who wrote it. Nothing is saved until you publish."
          run={() => ({ path: `/ai/reviews/${groupId}/digest` })}
          slipTitle="What reviewers say — a draft, not on the page"
          busyLabel="Reading…"
          acceptNote="…then read it once more and press Publish."
          renderDraft={(r) => (r.enough === false
            ? <p className="aidraft-prose">Fewer than two written reviews on this product — nothing to sum up yet.</p>
            : (
              <>
                <p className="aidraft-prose">{r.text}</p>
                {/* The figures are the shop's, from the rows it read — never
                    the model's. That is why they sit under the prose rather
                    than in it. */}
                <p className="arv-digest-meta">
                  Read {r.reviewCount} review{r.reviewCount === 1 ? '' : 's'}
                  {r.hiddenCount ? `, ${r.hiddenCount} hidden from customers` : ''}
                  {r.flagged ? `, ${r.flagged} carrying a link, handle, number or address` : ''}.
                </p>
              </>
            ))}
          actions={[{
            label: 'Publish to product page…',
            icon: Store,
            primary: true,
            // Absent under the "nothing to sum up" answer: there is no text
            // to carry, so there is nothing for the button to do.
            when: (r) => r?.enough !== false && Boolean(r?.text),
            // Into the composer, never onto the page. The draft was read from
            // hidden reviews as well as visible ones and may quote what a
            // moderator hid; it goes public only after they have read it as
            // a buyer would.
            onAccept: (r) => setComposer({ text: r.text }),
          }]}
        />
        {!composer && (
          <button
            type="button"
            className="aidraft-link"
            onClick={() => setComposer({ text: current?.text ?? '' })}
            title={current ? 'Change the paragraph on the product page' : 'Put a paragraph on the product page without a model'}
          >
            <PenLine size={11} aria-hidden="true" />
            {current ? 'Edit the summary' : 'Write one by hand'}
          </button>
        )}
      </div>

      {current && !composer && (
        <div className="arv-summary-published" role="group" aria-label="On the product page">
          <div className="arv-summary-status">
            <Store size={12} aria-hidden="true" />
            <span>
              On the product page since {formatDate(current.at)} · from {current.based_on} review{current.based_on === 1 ? '' : 's'}
            </span>
            {stale && (
              <span className="arv-summary-stale">
                {published.visible} visible now
              </span>
            )}
          </div>
          <details className="arv-summary-text">
            <summary>Show the text</summary>
            <p className="aidraft-prose">{current.text}</p>
          </details>
          <div className="aidraft-slip-actions">
            <button type="button" className="aidraft-accept" onClick={() => setComposer({ text: current.text })}>
              <PenLine size={12} aria-hidden="true" /> Edit
            </button>
            <button type="button" className="aidraft-accept arv-summary-remove" onClick={remove}>
              <Trash2 size={12} aria-hidden="true" /> Remove from product page
            </button>
          </div>
        </div>
      )}

      {composer && (
        <div className="arv-summary-composer" role="group" aria-label="Summary for the product page">
          <div className="aidraft-slip-head">
            <span className="aidraft-slip-title">
              {current ? 'Replace what is on the product page' : 'For the product page — check it, then publish'}
            </span>
            <div className="aidraft-slip-tools">
              <button type="button" className="aidraft-link" onClick={() => setComposer(null)} disabled={saving}>
                <X size={11} aria-hidden="true" /> Cancel
              </button>
            </div>
          </div>
          <textarea
            className="glass-input arv-summary-input"
            value={composer.text}
            onChange={(e) => setComposer({ text: e.target.value })}
            rows={6}
            aria-label="Summary text"
            placeholder="What buyers say about this product, in the store's words."
          />
          <div className="arv-summary-foot">
            <span className={`arv-summary-count${over ? ' is-over' : ''}`} aria-live="polite">
              {draftLen} / {SUMMARY_MAX}
            </span>
            {/* The page prints the review count and the date itself, from the
                row — so the paragraph should not, and must not carry a price
                or a stock figure: docs/AI.md §7, the model never states a
                number, and neither does the store's paragraph about it. */}
            <span className="aidraft-slip-note">
              Plain text; formatting is removed. The page adds &ldquo;from N reviews&rdquo; and the date — leave prices, stock and counts out.
            </span>
            <button
              type="button"
              className="aidraft-accept is-primary"
              onClick={publish}
              disabled={saving || !draftLen || over}
            >
              {saving
                ? <span className="spinner spinner-inline" aria-hidden="true" />
                : <Store size={12} aria-hidden="true" />}
              {current ? 'Replace on product page' : 'Publish to product page'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
