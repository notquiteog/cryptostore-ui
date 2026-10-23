import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { AlertTriangle, ExternalLink, Plus, RotateCcw, Trash2, Wand2 } from 'lucide-react';
import { api } from '../../utils/api';
import {
  FILL_MODES, fillProblem, moneyFromCents, movePriceCents, parseMoney, rowProblem, sheetChanges, tiersEqual,
} from '../../utils/priceSheet';

/**
 * The price sheet: every live variant of the picked products, with its list
 * price and its volume ladder, edited as numbers.
 *
 * ── What this replaced, and why ─────────────────────────────────────────────
 *
 * The picked-set bar used to open a percentage box: move every live variant
 * under the picked products by N%, preview the before/after pairs, apply.
 * Fine for "ten percent off the shelf", and useless for the thing an operator
 * actually sits down to do with forty prices in front of them — set THIS size
 * to 24.99 and THAT one to 44.99, and give the 3.5g a 3+ band at 22. The
 * percentage box could not say any of that, and it could not reach a volume
 * tier at all; "discount tiers are left alone" was the panel's own footnote.
 *
 * So the same selection opens this instead. The percentage survives as the
 * fill row at the top — it pre-fills the list-price column, and then the
 * operator READS the column before anything is saved, which is the safety
 * argument the old preview made, moved to where the numbers can still be
 * changed.
 *
 * ── The shape (DESIGN.md §6) ────────────────────────────────────────────────
 *
 * Two real views, not one table squeezed. Wide: one line per variant with
 * aligned columns — name, price, ladder — scannable down one axis, numerals
 * tabular. Narrow (a container query, because this panel is as wide as the
 * bar it sits in, not as wide as the window): each variant becomes a dense
 * card with the same three fields stacked and labelled. Nothing is hidden on
 * the phone; the ladder is edited there too.
 *
 * ── What the server checks that this also checks ────────────────────────────
 *
 * Every refusal the server makes (`server/utils/priceSheet.js`) is made here
 * first, beside the box, so a sheet of forty rows never answers with a toast
 * naming a row the operator has to go and find. The server still makes them,
 * because a stale tab or a script can send anything.
 */

const blankEdit = (v) => ({
  price: v.price,
  tiers: (v.tiers || []).map((t) => ({ min_qty_label: t.min_qty_label, price: t.price })),
});

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function PriceSheet({ groupIds, onSaved, onCancel }) {
  const key = groupIds.join(',');
  const [sheet, setSheet] = useState(null);
  const [edits, setEdits] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fillMode, setFillMode] = useState('percent');
  const [fillValue, setFillValue] = useState('');
  const [review, setReview] = useState(null);
  const [busy, setBusy] = useState(false);
  // Rows a colleague changed while this sheet was open, by variant id. Kept
  // until the row is edited, reset, or the sheet saves — the flag is the whole
  // explanation for why that row's numbers just changed under the operator.
  const [moved, setMoved] = useState(() => new Map());

  const load = useCallback(async (resetIds = null) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/products/prices/sheet?group_ids=${key}`);
      setSheet(data);
      setEdits((prev) => {
        const next = {};
        for (const p of data.products) {
          for (const v of p.variants) {
            // A reload after a conflict keeps what the operator typed on every
            // row that did NOT move; the rows that did take the colleague's
            // numbers, because the edit was made against a price that is gone.
            next[v.id] = resetIds && prev[v.id] && !resetIds.has(v.id) ? prev[v.id] : blankEdit(v);
          }
        }
        return next;
      });
    } catch (err) {
      setError(err.message || 'Could not read those prices');
    }
    setLoading(false);
  }, [key]);

  useEffect(() => { load(); }, [load]);

  const changes = useMemo(() => (sheet ? sheetChanges(sheet.products, edits) : null), [sheet, edits]);
  const reviewById = useMemo(() => new Map((review?.variants || []).map((r) => [r.variant_id, r])), [review]);
  const variantCount = sheet ? sheet.products.reduce((n, p) => n + p.variants.length, 0) : 0;

  /* Every edit drops the review: a count and a below-cost list computed for a
     sheet that no longer says what it said is the one thing this panel exists
     to prevent. Same rule the percentage box had for its preview. */
  const patch = (id, fn) => {
    setEdits((prev) => ({ ...prev, [id]: fn(prev[id]) }));
    setReview(null);
    if (moved.has(id)) setMoved((prev) => { const next = new Map(prev); next.delete(id); return next; });
  };
  const setPrice = (id, price) => patch(id, (e) => ({ ...e, price }));
  const setTier = (id, i, fields) => patch(id, (e) => ({ ...e, tiers: e.tiers.map((t, j) => (j === i ? { ...t, ...fields } : t)) }));
  const addTier = (id) => patch(id, (e) => ({ ...e, tiers: [...e.tiers, { min_qty_label: '', price: '' }] }));
  const removeTier = (id, i) => patch(id, (e) => ({ ...e, tiers: e.tiers.filter((_, j) => j !== i) }));
  const resetRow = (id, v) => patch(id, () => blankEdit(v));

  /* The fill works from the SAVED price, not the typed one, so pressing it
     twice with different numbers gives the second answer rather than the
     second applied to the first — and so the hint can say "lower than it is
     now" and mean it. Hand-typed list prices are replaced; the row's undo
     puts any of them back. Ladders are never filled: a band is authored per
     size, and a percentage swept across forty ladders is exactly the edit
     nobody reads before saving. */
  const fillAll = () => {
    if (!sheet || fillProblem(fillMode, fillValue)) return;
    const value = Number(fillValue);
    setEdits((prev) => {
      const next = { ...prev };
      for (const p of sheet.products) {
        for (const v of p.variants) {
          const base = parseMoney(v.price) ?? 0;
          next[v.id] = { ...prev[v.id], price: moneyFromCents(movePriceCents(base, fillMode, value)) };
        }
      }
      return next;
    });
    setReview(null);
    setMoved(new Map());
  };

  const discard = () => {
    if (!sheet) return;
    const next = {};
    for (const p of sheet.products) for (const v of p.variants) next[v.id] = blankEdit(v);
    setEdits(next);
    setReview(null);
    setMoved(new Map());
  };

  const send = (dryRun) => api.post('/products/prices/adjust', {
    mode: 'sheet',
    rows: changes.rows,
    // The before-column of the sheet the operator is looking at — price AND
    // ladder — echoed back. The server refuses the whole batch if any of it
    // has moved since, which is what makes "save what I typed" mean that.
    expect: changes.expect,
    ...(dryRun ? {} : { dry_run: false }),
  });

  const onConflict = async (err) => {
    const ids = new Set((err?.data?.moved || []).map((m) => m.variant_id));
    toast.error(err.message, { duration: 8000 });
    setMoved(new Map((err?.data?.moved || []).map((m) => [m.variant_id, m])));
    setReview(null);
    await load(ids.size ? ids : new Set());
  };

  const askReview = async () => {
    setBusy(true);
    try {
      setReview(await send(true));
    } catch (err) {
      if (err?.data?.code === 'prices_moved') await onConflict(err);
      else toast.error(err.message || 'Could not check those prices');
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await send(false);
      const bits = [];
      if (r.prices_changed) bits.push(plural(r.prices_changed, 'list price'));
      if (r.ladders_changed) bits.push(plural(r.ladders_changed, 'ladder'));
      toast.success(bits.length ? `${bits.join(' and ')} saved` : 'Nothing needed changing');
      onSaved(r);
    } catch (err) {
      if (err?.data?.code === 'prices_moved') await onConflict(err);
      else toast.error(err.message || 'That did not save');
    }
    setBusy(false);
  };

  const fillMeta = FILL_MODES.find((m) => m.key === fillMode) || FILL_MODES[0];
  const fillBlocked = fillProblem(fillMode, fillValue);

  return (
    <div className="apr-catpanel psh" role="region" aria-label="Price sheet">
      <label className="psh-title" htmlFor="psh-fill-mode">
        Price sheet — {plural(groupIds.length, 'picked product')}
        {sheet ? `, ${plural(variantCount, 'live variant')}` : ''}
      </label>
      <small className="psh-lede">
        Every live variant, with its list price and its volume tiers, edited as the numbers themselves.
        Hidden variants keep the price they were retired at. Nothing is saved until you press Save.
      </small>

      {loading && !sheet && (
        <p className="psh-note"><span className="spinner spinner-inline" /> Reading prices…</p>
      )}
      {error && (
        <p className="apr-del-warn">
          <AlertTriangle size={14} aria-hidden="true" />
          <span>{error} </span>
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => load()}>Try again</button>
        </p>
      )}

      {sheet && (
        <>
          {/* ── The fill row ──
              The percentage tool, kept as a way to pre-fill the column below.
              It changes the boxes, not the shop; the operator reads the result
              and Save is what writes it. */}
          <div className="psh-fill">
            <Wand2 size={14} aria-hidden="true" className="psh-fill-icon" />
            <select
              id="psh-fill-mode"
              className="glass-input psh-fill-mode"
              value={fillMode}
              onChange={(e) => setFillMode(e.target.value)}
            >
              {FILL_MODES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>
            <input
              className="glass-input psh-fill-value"
              type="number"
              step="any"
              inputMode="decimal"
              value={fillValue}
              placeholder={fillMode === 'percent' ? '−10' : '0.00'}
              aria-label={`Amount to fill list prices with, in ${fillMode === 'percent' ? 'percent' : 'dollars'}`}
              onChange={(e) => setFillValue(e.target.value)}
            />
            <span className="apr-price-unit" aria-hidden="true">{fillMeta.unit}</span>
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              onClick={fillAll}
              disabled={!!fillBlocked || variantCount === 0}
              title={fillBlocked || undefined}
            >
              Fill list prices
            </button>
            <small>{fillMeta.hint} Fills the boxes below from the saved prices; tiers are left for you.</small>
          </div>

          {/* ── The sheet ── */}
          <div className="psh-sheet">
            {sheet.products.map((p) => (
              <section key={p.id} className="psh-product" aria-label={p.name}>
                <header className="psh-product-head">
                  <span className="psh-product-name">{p.name}</span>
                  {(p.category || p.brand) && (
                    <span className="psh-product-meta">{[p.category, p.brand].filter(Boolean).join(' · ')}</span>
                  )}
                  <Link to={`/admin/products/${p.id}/edit`} className="psh-product-link">
                    Open editor <ExternalLink size={11} aria-hidden="true" />
                  </Link>
                </header>
                {p.variants.length === 0 ? (
                  <p className="psh-empty">No live variants — hidden sizes keep the price they were retired at.</p>
                ) : (
                  <div className="psh-rows">
                    <div className="psh-row psh-row-head" aria-hidden="true">
                      <span>Variant</span>
                      <span>List price</span>
                      <span>Volume tiers</span>
                    </div>
                    {p.variants.map((v) => (
                      <VariantRow
                        key={v.id}
                        product={p}
                        variant={v}
                        edit={edits[v.id] || blankEdit(v)}
                        costKnown={sheet.cost_known}
                        reviewRow={reviewById.get(v.id)}
                        movedRow={moved.get(v.id)}
                        onPrice={(price) => setPrice(v.id, price)}
                        onTier={(i, fields) => setTier(v.id, i, fields)}
                        onAddTier={() => addTier(v.id)}
                        onRemoveTier={(i) => removeTier(v.id, i)}
                        onReset={() => resetRow(v.id, v)}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>

          {/* ── The foot: what changed, what is wrong, and the two presses ── */}
          <div className="psh-foot">
            <p className="psh-summary" aria-live="polite">
              {changes.changed === 0
                ? 'Nothing changed yet.'
                : [
                  changes.prices ? plural(changes.prices, 'list price') : null,
                  changes.ladders ? plural(changes.ladders, 'ladder') : null,
                ].filter(Boolean).join(' and ') + ` changed on ${plural(changes.products, 'product')}.`}
              {changes.invalid.length > 0 && (
                <span className="psh-summary-bad"> {plural(changes.invalid.length, 'row needs', 'rows need')} attention before this can be saved.</span>
              )}
            </p>

            {review && review.below_cost > 0 && (
              <p className="apr-del-warn">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>
                  {review.below_cost} of these would sell below what this shop paid — the list price or a
                  band on the ladder. That is a decision to make on purpose; a clearance or a loss leader
                  is a real thing, but it is worth making with the number in front of you.
                  {review.cost_unknown > 0 && ` ${review.cost_unknown} more have no recorded cost, so they could not be checked.`}
                </span>
              </p>
            )}

            <div className="apr-catpanel-row psh-acts">
              {review ? (
                <button type="button" className="glass-btn glass-btn-primary" onClick={save} disabled={busy || review.changing === 0}>
                  {busy ? 'Saving…' : `Save ${plural(review.changing, 'change')}`}
                </button>
              ) : (
                <button
                  type="button"
                  className="glass-btn glass-btn-primary"
                  onClick={askReview}
                  disabled={busy || loading || changes.changed === 0 || changes.invalid.length > 0}
                >
                  {busy ? 'Checking…' : changes.changed === 0 ? 'Review changes' : `Review ${plural(changes.changed, 'change')}`}
                </button>
              )}
              <button type="button" className="glass-btn" onClick={discard} disabled={busy || changes.changed === 0}>
                <RotateCcw size={13} aria-hidden="true" /> Discard edits
              </button>
              <button type="button" className="glass-btn" onClick={onCancel} disabled={busy}>Close</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function VariantRow({ product, variant, edit, costKnown, reviewRow, movedRow, onPrice, onTier, onAddTier, onRemoveTier, onReset }) {
  const problem = rowProblem(edit);
  const priceCents = parseMoney(edit.price);
  const priceChanged = priceCents !== parseMoney(variant.price);
  const ladderChanged = !tiersEqual(edit.tiers, variant.tiers);
  const changed = priceChanged || ladderChanged;
  // Said here, live, and not only after the review: the lowest figure on the
  // row — list price or any band — against what the shop paid. Never enforced.
  const costCents = costKnown && variant.unit_cost !== undefined ? parseMoney(variant.unit_cost) : null;
  const lowest = problem ? null : Math.min(priceCents, ...edit.tiers.map((t) => parseMoney(t.price)));
  const belowCost = reviewRow?.below_cost || (costCents !== null && lowest !== null && lowest < costCents);
  const name = `${product.name}${variant.name ? ` — ${variant.name}` : ''}`;
  const cls = ['psh-row', changed ? 'is-changed' : '', problem ? 'is-invalid' : '', belowCost ? 'is-below' : '', movedRow ? 'is-moved' : '']
    .filter(Boolean).join(' ');

  return (
    <div className={cls}>
      <div className="psh-cell psh-variant">
        <span className="psh-variant-name">{variant.name || <em>Untitled variant</em>}</span>
        {movedRow && (
          <span className="psh-flag is-warning">
            changed by a colleague{movedRow.ladder ? ', ladder included' : ''} — showing their numbers
          </span>
        )}
        {changed && (
          <button type="button" className="psh-reset" onClick={onReset} aria-label={`Put ${name} back to what is saved`}>
            <RotateCcw size={11} aria-hidden="true" /> undo
          </button>
        )}
      </div>

      <div className="psh-cell psh-price">
        <span className="psh-cell-label" aria-hidden="true">List price</span>
        <div className="psh-money">
          <span className="psh-money-sign" aria-hidden="true">$</span>
          <input
            className="glass-input"
            type="number"
            step="0.01"
            min="0"
            inputMode="decimal"
            value={edit.price}
            aria-label={`${name} list price`}
            onChange={(e) => onPrice(e.target.value)}
          />
        </div>
        {priceChanged && <span className="psh-was">was ${variant.price}</span>}
        {costCents !== null && (
          <span className={`psh-cost${belowCost ? ' is-below' : ''}`}>cost ${variant.unit_cost}</span>
        )}
      </div>

      <div className="psh-cell psh-tiers">
        <span className="psh-cell-label" aria-hidden="true">Volume tiers</span>
        {edit.tiers.map((t, i) => (
          <div key={i} className="psh-tier">
            <input
              className="glass-input psh-tier-label"
              value={t.min_qty_label}
              placeholder="3+"
              maxLength={32}
              aria-label={`${name} tier ${i + 1} quantity`}
              onChange={(e) => onTier(i, { min_qty_label: e.target.value })}
            />
            <div className="psh-money psh-tier-price">
              <span className="psh-money-sign" aria-hidden="true">$</span>
              <input
                className="glass-input"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                value={t.price}
                placeholder="0.00"
                aria-label={`${name} tier ${i + 1} price`}
                onChange={(e) => onTier(i, { price: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="glass-btn glass-btn-danger glass-btn-sm psh-tier-remove"
              onClick={() => onRemoveTier(i)}
              aria-label={`Remove tier ${i + 1} from ${name}`}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
        ))}
        <div className="psh-tier-foot">
          <button type="button" className="glass-btn glass-btn-sm psh-tier-add" onClick={onAddTier}>
            <Plus size={12} aria-hidden="true" /> {edit.tiers.length ? 'Add band' : 'Add a band'}
          </button>
          {ladderChanged && !priceChanged && <span className="psh-was">ladder changed</span>}
          {edit.tiers.length === 0 && !ladderChanged && <span className="psh-muted">No tiers — every quantity pays the list price.</span>}
        </div>
      </div>

      {problem && (
        <p className="psh-problem" role="alert">
          <AlertTriangle size={12} aria-hidden="true" /> {problem}
        </p>
      )}
    </div>
  );
}
