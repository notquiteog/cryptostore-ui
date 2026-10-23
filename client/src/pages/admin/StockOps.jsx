import SharedStockPool from '../../components/admin/SharedStockPool';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ClipboardCheck, PackagePlus, Undo2, Search, Check, X, TriangleAlert,
  Boxes, Inbox, ArrowDown, ArrowUp, MapPin, Clock, ShieldCheck, Trash2,
} from 'lucide-react';
import { api } from '../../utils/api';
import { playSound } from '../../utils/sounds';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import StatTiles from '../../components/admin/StatTiles';
import { bustShelfContents } from '../../utils/shelfContents';
import { useTheme } from '../../context/ThemeContext';

/**
 * Stock operations: counting a shelf, booking goods in, taking goods back.
 *
 * ── Why these three share a screen ──────────────────────────────────────────
 *
 * They are the three events that legitimately change how much stock the store
 * believes it has, and they are the same physical job — somebody standing at a
 * shelf with a scanner or a clipboard. Splitting them into three pages would
 * mean three navigations for one trip to goods-in, and the operator would have
 * to know in advance which of the three a given carton turns out to be.
 *
 * ── The permission story, visible in the UI ─────────────────────────────────
 *
 * Counting is `products.count`; APPLYING a count is `products.stock`. Somebody
 * holding only the first records a discrepancy that waits for approval, and the
 * form says so before they press, rather than after. Receiving is
 * `products.receive`, returns are `orders.returns`, and a tab whose grant the
 * viewer lacks is not rendered at all — a tab that 403s on open is worse than
 * an absent one.
 *
 * Nothing here prices anything. Booking goods back in is a warehouse event;
 * refunding is a money event and still lives behind orders.refund_credit on the
 * order page, which is why a warehouse hand can receive a parcel without being
 * able to move money.
 */

/** Variant search shared by all three forms — one lookup, one shape. */
function VariantPicker({ value, onPick, label, autoFocus }) {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setRows([]); return undefined; }
    clearTimeout(timer.current);
    // Debounced: this is typed at a bench, and a request per keystroke against
    // a 3,000-variant catalogue is a request per keystroke too many.
    timer.current = setTimeout(() => {
      api.get('/fulfilment/bins')
        .then((res) => {
          const needle = q.toLowerCase();
          setRows((res.variants || [])
            .filter((v) => `${v.group_name} ${v.variant_name}`.toLowerCase().includes(needle))
            .slice(0, 20));
          setOpen(true);
        })
        .catch(() => setRows([]));
    }, 220);
    return () => clearTimeout(timer.current);
  }, [query]);

  if (value) {
    return (
      <div className="stk-picked">
        <span className="stk-picked-name">
          <strong>{value.group_name}</strong>
          <em>{value.variant_name}</em>
        </span>
        <span className="stk-picked-meta">
          {value.bin_location
            ? <><MapPin size={11} aria-hidden="true" /> {value.bin_location}</>
            : 'unfiled'}
          <span aria-hidden="true"> · </span>
          {value.quantity} on hand
        </span>
        <button type="button" className="stk-picked-clear" onClick={() => { onPick(null); setQuery(''); }} aria-label="Choose a different variant">
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div className="stk-search">
      <div className="admin-search">
        <Search size={14} aria-hidden="true" />
        <input
          className="glass-input"
          type="search"
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a product or variant"
          aria-label={label || 'Find a variant'}
        />
      </div>
      {open && rows.length > 0 && (
        <ul className="stk-results">
          {rows.map((v) => (
            <li key={v.variant_id}>
              <button type="button" onClick={() => { onPick(v); setOpen(false); }}>
                <span className="stk-res-group">{v.group_name}</span>
                <span className="stk-res-variant">{v.variant_name}</span>
                <span className="stk-res-bin">{v.bin_location || 'unfiled'}</span>
                <span className="stk-res-qty">{v.quantity}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─────────────────────────────── Counting ─────────────────────────────── */

function CountTab({ canApply, onChanged }) {
  const [variant, setVariant] = useState(null);
  const [bin, setBin] = useState('');
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState([]);
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/stock/counts/pending');
      setPending(res.counts || []);
      setSummary(res.summary || null);
    } catch { /* a failed poll is not worth a toast at a shelf */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Pre-fill the bin from the variant's shelf: the overwhelmingly common count
  // is "the shelf it is supposed to be on".
  useEffect(() => { setBin(variant?.bin_location || ''); }, [variant]);

  const expected = useMemo(() => {
    if (!variant) return null;
    return bin && bin !== variant.bin_location ? null : variant.quantity;
  }, [variant, bin]);

  const delta = useMemo(() => {
    if (expected == null || counted === '') return null;
    const n = parseInt(counted, 10);
    return Number.isInteger(n) ? n - expected : null;
  }, [expected, counted]);

  const submit = async () => {
    if (!variant) return toast.error('Pick a variant first');
    const n = parseInt(counted, 10);
    if (!Number.isInteger(n) || n < 0) return toast.error('Enter the number of units on the shelf');
    setBusy(true);
    try {
      const res = await api.post('/stock/counts', {
        variant_id: variant.variant_id, bin_location: bin || null, counted: n, note: note || undefined,
      });
      playSound('tick');
      toast.success(res.message);
      setVariant(null); setCounted(''); setNote('');
      bustShelfContents();
      load(); onChanged?.();
    } catch (err) {
      toast.error(err.message || 'Could not record the count');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  const resolve = async (id, approve) => {
    setBusy(true);
    try {
      await api.post(`/stock/counts/${id}/resolve`, { approve });
      toast.success(approve ? 'Applied' : 'Rejected');
      bustShelfContents();
      load(); onChanged?.();
    } catch (err) {
      toast.error(err.message || 'Could not resolve that count');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stk-grid">
      <section className="glass-card stk-form">
        <h3><ClipboardCheck size={15} aria-hidden="true" /> Count a shelf</h3>
        <p className="stk-lede">
          {canApply
            ? 'You can adjust stock, so a count applies the moment you record it.'
            : 'Your count is filed for approval by someone who can adjust stock — the shelf figure does not move until then.'}
        </p>

        <VariantPicker value={variant} onPick={setVariant} label="Variant to count" autoFocus />
        {variant && <SharedStockPool key={variant.variant_id} variantId={variant.variant_id} mode="count" quantity={counted} bin={bin} />}

        {variant && (
          <>
            <label className="stk-field">
              <span>Shelf <em>(blank counts the whole variant)</em></span>
              <input
                className="glass-input"
                value={bin}
                maxLength={32}
                placeholder={variant.bin_location || 'A1-L2-S3'}
                onChange={(e) => setBin(e.target.value.toUpperCase())}
              />
            </label>
            <label className="stk-field">
              <span>Units actually there</span>
              <input
                className="glass-input stk-count-input"
                type="number"
                min="0"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
            </label>

            {delta !== null && (
              <p className={`stk-delta${delta === 0 ? ' is-match' : delta < 0 ? ' is-short' : ' is-over'}`}>
                {delta === 0 && <><Check size={13} aria-hidden="true" /> Matches the {expected} on record.</>}
                {delta < 0 && <><ArrowDown size={13} aria-hidden="true" /> {-delta} fewer than the {expected} on record.</>}
                {delta > 0 && <><ArrowUp size={13} aria-hidden="true" /> {delta} more than the {expected} on record.</>}
              </p>
            )}

            <label className="stk-field">
              <span>Note <em>(optional)</em></span>
              <input
                className="glass-input"
                value={note}
                maxLength={280}
                placeholder="e.g. two were water-damaged"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <button type="button" className="glass-btn glass-btn-primary" onClick={submit} disabled={busy}>
              <ClipboardCheck size={14} aria-hidden="true" />
              {canApply ? 'Count and adjust' : 'File this count'}
            </button>
          </>
        )}
      </section>

      {/* `is-quiet` when there is nothing waiting.

          An approval queue with nothing in it was still holding two thirds of
          the screen open to say so — a 750px panel whose entire content was
          one grey sentence, sitting next to the form somebody actually came
          here to use. Empty, it shrinks to a note beside the form; the moment
          a count is filed it takes the width back. */}
      <section className={`glass-card stk-list${pending.length === 0 ? ' is-quiet' : ''}`}>
        <h3>
          <Clock size={15} aria-hidden="true" /> Waiting for approval
          {summary && summary.pending > 0 && <span className="stk-badge">{summary.pending}</span>}
        </h3>
        {pending.length === 0 ? (
          <p className="stk-none">Nothing is waiting. Counts recorded by someone who can adjust stock apply straight away.</p>
        ) : (
          <ul className="stk-rows">
            {pending.map((c) => (
              <li key={c.id}>
                <div className="stk-row-main">
                  <span className="stk-row-name">
                    <strong>{c.group_name}</strong>
                    <em>{c.variant_name}</em>
                  </span>
                  <span className="stk-row-meta">
                    {c.bin_location && <code>{c.bin_location}</code>}
                    counted {c.counted} vs {c.expected}
                    {c.counted_by_username && <> · {c.counted_by_username}</>}
                  </span>
                  {c.note && <span className="stk-row-note">{c.note}</span>}
                </div>
                <span className={`stk-row-delta${c.delta < 0 ? ' is-short' : c.delta > 0 ? ' is-over' : ''}`}>
                  {c.delta > 0 ? `+${c.delta}` : c.delta}
                </span>
                {canApply && (
                  <span className="stk-row-actions">
                    <button type="button" className="glass-btn glass-btn-sm glass-btn-success" onClick={() => resolve(c.id, true)} disabled={busy} title="Apply this correction to stock">
                      <Check size={13} aria-hidden="true" /> Apply
                    </button>
                    <button type="button" className="glass-btn glass-btn-sm" onClick={() => resolve(c.id, false)} disabled={busy} title="Reject — stock is left alone">
                      <X size={13} aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ────────────────────────────── Receiving ────────────────────────────── */

function ReceiveTab({ onChanged }) {
  const [variant, setVariant] = useState(null);
  const [bin, setBin] = useState('');
  const [qty, setQty] = useState('');
  const [reference, setReference] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);
  const [summary, setSummary] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/stock/receipts');
      setRecent(res.receipts || []);
      setSummary(res.summary || null);
    } catch { /* quiet */ }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { setBin(variant?.bin_location || ''); }, [variant]);

  const submit = async () => {
    if (!variant) return toast.error('Pick a variant first');
    const n = parseInt(qty, 10);
    if (!Number.isInteger(n) || n < 1) return toast.error('How many units arrived?');
    setBusy(true);
    try {
      const res = await api.post('/stock/receipts', {
        variant_id: variant.variant_id,
        bin_location: bin || null,
        quantity: n,
        reference: reference || undefined,
        note: note || undefined,
        // Sent as typed. The server converts to whole cents and refuses a
        // shape it cannot read, rather than this form guessing — one
        // definition of what a cost looks like, in `services/stockReceipts`.
        unit_cost: unitCost.trim() || undefined,
      });
      playSound('tick');
      toast.success(`Booked in — ${res.on_hand} on hand${res.bin_location ? ` on ${res.bin_location}` : ''}`);
      // The reference and the cost survive on purpose: a delivery is booked in
      // line by line, and the consignment number and the price per unit are
      // usually the same across several of them. Clearing them would mean
      // retyping the same two fields for every line of one pallet.
      setVariant(null); setQty(''); setNote('');
      bustShelfContents();
      load(); onChanged?.();
    } catch (err) {
      toast.error(err.message || 'Could not receive that');
    } finally {
      setBusy(false);
    }
    return undefined;
  };

  return (
    <div className="stk-grid">
      <section className="glass-card stk-form">
        <h3><PackagePlus size={15} aria-hidden="true" /> Book goods in</h3>
        <p className="stk-lede">
          Raises on-hand stock and files it to a shelf. Every receipt is recorded, so
          &ldquo;where did these come from&rdquo; has an answer later.
        </p>

        <VariantPicker value={variant} onPick={setVariant} label="Variant received" autoFocus />
        {variant && <SharedStockPool key={variant.variant_id} variantId={variant.variant_id} mode="receive" quantity={qty} />}

        {variant && (
          <>
            <div className="stk-row2">
              <label className="stk-field">
                <span>Units received</span>
                <input
                  className="glass-input stk-count-input"
                  type="number"
                  min="1"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
                />
              </label>
              <label className="stk-field">
                <span>Onto shelf <em>(optional)</em></span>
                <input
                  className="glass-input"
                  value={bin}
                  maxLength={32}
                  placeholder="A1-L2-S3"
                  onChange={(e) => setBin(e.target.value.toUpperCase())}
                />
              </label>
            </div>
            <label className="stk-field">
              <span>Reference <em>(optional)</em></span>
              <input
                className="glass-input"
                value={reference}
                maxLength={64}
                placeholder="consignment number, courier, whatever identifies it"
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            {/* ── What it cost ──
                Optional, and it stays optional: every receipt already in the
                table has no cost, and a form that demanded one would make the
                operator invent figures to get past it. Left blank the shop
                simply has no opinion about the margin on this option, which is
                exactly where it was before.

                No supplier, no invoice, no purchase order — see
                `services/stockReceipts.js`. This is a number about goods, not
                a record about a person. */}
            <label className="stk-field">
              <span>Cost per unit <em>(optional)</em></span>
              <input
                className="glass-input"
                inputMode="decimal"
                value={unitCost}
                maxLength={16}
                placeholder="what you paid for one, e.g. 12.50"
                onChange={(e) => setUnitCost(e.target.value)}
              />
              <small>
                Used for margin reporting and to flag a sale below cost. Never shown to buyers.
              </small>
            </label>
            <label className="stk-field">
              <span>Note <em>(optional)</em></span>
              <input
                className="glass-input"
                value={note}
                maxLength={280}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button type="button" className="glass-btn glass-btn-primary" onClick={submit} disabled={busy}>
              <PackagePlus size={14} aria-hidden="true" /> Receive {qty || ''} unit{qty === '1' ? '' : 's'}
            </button>
            {!bin && (
              <p className="stk-warn">
                <TriangleAlert size={12} aria-hidden="true" />
                Without a shelf these units are in the system but on no shelf a picker can be sent to.
              </p>
            )}
          </>
        )}
      </section>

      <section className="glass-card stk-list">
        <h3>
          <Inbox size={15} aria-hidden="true" /> Recently received
          {summary && summary.unfiled > 0 && (
            <span className="stk-badge is-warn" title="Received but not filed to a shelf">
              {summary.unfiled} unfiled
            </span>
          )}
        </h3>
        {recent.length === 0 ? (
          <p className="stk-none">Nothing booked in yet.</p>
        ) : (
          <ul className="stk-rows">
            {recent.slice(0, 25).map((r) => (
              <li key={r.id}>
                <div className="stk-row-main">
                  <span className="stk-row-name">
                    <strong>{r.group_name}</strong>
                    <em>{r.variant_name}</em>
                  </span>
                  <span className="stk-row-meta">
                    {r.bin_location ? <code>{r.bin_location}</code> : <span className="stk-unfiled">unfiled</span>}
                    {r.reference && <> · {r.reference}</>}
                    {r.received_by_username && <> · {r.received_by_username}</>}
                    <> · {new Date(r.received_at).toLocaleDateString()}</>
                  </span>
                </div>
                <span className="stk-row-delta is-over">+{r.quantity}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ─────────────────────────────── Returns ─────────────────────────────── */

function ReturnsTab({ onChanged }) {
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [open, setOpen] = useState(null); // the return being received
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/stock/returns?status=open');
      setRows(res.returns || []);
      setSummary(res.summary || null);
    } catch { /* quiet */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openOne = async (id) => {
    try { setOpen(await api.get(`/stock/returns/${id}`)); } catch (err) { toast.error(err.message); }
  };

  const receive = async () => {
    if (!open) return;
    setBusy(true);
    try {
      const res = await api.post(`/stock/returns/${open.id}/receive`, {
        lines: open.lines.map((l) => ({
          id: l.id,
          received_quantity: l.received_quantity,
          condition: l.condition || 'sellable',
          bin_location: l.bin_location || l.suggested_bin || null,
        })),
      });
      toast.success(`Booked back in — ${res.restocked} restocked, ${res.damaged} written off`);
      bustShelfContents();
      setOpen(null); load(); onChanged?.();
    } catch (err) {
      toast.error(err.message || 'Could not receive that return');
    } finally {
      setBusy(false);
    }
  };

  const close = async (id, cancel) => {
    try {
      await api.post(`/stock/returns/${id}/close`, { cancel });
      toast.success(cancel ? 'Cancelled' : 'Closed');
      setOpen(null); load();
    } catch (err) { toast.error(err.message); }
  };

  const patchLine = (lineId, fields) => setOpen((prev) => (prev ? {
    ...prev, lines: prev.lines.map((l) => (l.id === lineId ? { ...l, ...fields } : l)),
  } : prev));

  return (
    <div className="stk-grid">
      <section className="glass-card stk-list stk-wide">
        <h3>
          <Undo2 size={15} aria-hidden="true" /> Open returns
          {summary && summary.expected > 0 && <span className="stk-badge">{summary.expected} expected</span>}
        </h3>
        <p className="stk-lede">
          A return holds no buyer address — it is keyed to the order it came from.
          Open one from an order&apos;s page; book the goods in here when they arrive.
        </p>
        {rows.length === 0 ? (
          <p className="stk-none">No returns are open.</p>
        ) : (
          <ul className="stk-rows">
            {rows.map((r) => (
              <li key={r.id} className={open?.id === r.id ? 'is-open' : undefined}>
                <div className="stk-row-main">
                  <span className="stk-row-name">
                    <strong>{r.order_uuid ? r.order_uuid.split('-')[0].toUpperCase() : `#${r.order_id}`}</strong>
                    <em>{r.status}</em>
                  </span>
                  <span className="stk-row-meta">
                    {r.units_expected} expected
                    {r.units_received > 0 && <> · {r.units_received} received</>}
                    {r.units_restocked > 0 && <> · {r.units_restocked} restocked</>}
                    {r.opened_by_username && <> · {r.opened_by_username}</>}
                  </span>
                  {r.reason && <span className="stk-row-note">{r.reason}</span>}
                </div>
                <span className="stk-row-actions">
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => openOne(r.id)}>
                    {r.status === 'expected' ? 'Book in' : 'Review'}
                  </button>
                  <Link to={`/orders/${r.order_uuid}`} className="glass-btn glass-btn-sm">Order</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {open && (
        <section className="glass-card stk-form stk-wide">
          <h3><Boxes size={15} aria-hidden="true" /> What actually came back</h3>
          <p className="stk-lede">
            Only <strong>sellable</strong> units go back on a shelf. Damaged units are recorded and
            written off; missing units are the difference between what was promised and what arrived.
          </p>
          <ul className="stk-retlines">
            {open.lines.map((l) => (
              <li key={l.id}>
                <span className="stk-ret-name">
                  <strong>{l.product_name}</strong>
                  <em>{l.variant_name}</em>
                  <span className="stk-ret-exp">{l.quantity} expected</span>
                </span>
                <label className="stk-field stk-ret-qty">
                  <span>Received</span>
                  <input
                    className="glass-input"
                    type="number"
                    min="0"
                    max={l.quantity}
                    value={l.received_quantity}
                    onChange={(e) => patchLine(l.id, { received_quantity: Math.max(0, Math.min(l.quantity, parseInt(e.target.value, 10) || 0)) })}
                  />
                </label>
                <label className="stk-field stk-ret-cond">
                  <span>Condition</span>
                  <select
                    className="glass-input"
                    value={l.condition || 'sellable'}
                    onChange={(e) => patchLine(l.id, { condition: e.target.value })}
                  >
                    <option value="sellable">Sellable</option>
                    <option value="damaged">Damaged</option>
                    <option value="missing">Missing</option>
                  </select>
                </label>
                <label className="stk-field stk-ret-bin">
                  <span>Back onto</span>
                  <input
                    className="glass-input"
                    value={l.bin_location ?? l.suggested_bin ?? ''}
                    maxLength={32}
                    disabled={(l.condition || 'sellable') !== 'sellable'}
                    placeholder={l.suggested_bin || 'A1-L2-S3'}
                    onChange={(e) => patchLine(l.id, { bin_location: e.target.value.toUpperCase() })}
                  />
                </label>
              </li>
            ))}
          </ul>
          <div className="stk-ret-actions">
            <button type="button" className="glass-btn glass-btn-primary" onClick={receive} disabled={busy}>
              <ShieldCheck size={14} aria-hidden="true" /> Book these in
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => close(open.id, false)} disabled={busy}>
              Close return
            </button>
            <button type="button" className="glass-btn glass-btn-sm glass-btn-danger" onClick={() => close(open.id, true)} disabled={busy}>
              <Trash2 size={13} aria-hidden="true" /> Cancel
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => setOpen(null)}>Dismiss</button>
          </div>
        </section>
      )}
    </div>
  );
}

/* ──────────────────────────────── Page ──────────────────────────────── */

export default function StockOps() {
  const { user } = useAuth();
  const can = useMemo(() => adminCapabilities(user), [user]);
  const [recon, setRecon] = useState(null);
  const [counts, setCounts] = useState(null);

  // Whether this shop files stock on shelves at all (utils/warehouseEnabled.js).
  // Absent means on, matching the server's getBool and a payload that predates
  // the key.
  const { settings } = useTheme();
  const shelvesTracked = settings.warehouse_enabled !== 'false';

  const tabs = useMemo(() => [
    // Counting is shelf work: the form asks what is physically on a named
    // shelf, and on a shop with no shelves there is nothing to name. The
    // routes behind it 404 (`utils/warehouseEnabled.requireWarehouse`), so
    // leaving the tab would be a form that submits into a refusal.
    //
    // Receive and Returns stay. Booking in goods raises a quantity with or
    // without somewhere to put them, and a return comes back to the catalogue
    // rather than to a bin — which is why the shelf gate is on this tab and
    // not on the page.
    shelvesTracked && (can.countStock || can.adjustStock) && { key: 'count', label: 'Count', icon: ClipboardCheck },
    can.receiveStock && { key: 'receive', label: 'Receive', icon: PackagePlus },
    can.manageReturns && { key: 'returns', label: 'Returns', icon: Undo2 },
  ].filter(Boolean), [can, shelvesTracked]);

  const [tab, setTab] = useState(() => tabs[0]?.key || 'count');
  useEffect(() => { if (tabs.length && !tabs.some((t) => t.key === tab)) setTab(tabs[0].key); }, [tabs, tab]);

  const refresh = useCallback(async () => {
    // Both of these describe shelves, so neither is asked for on a shop that
    // has none. They would 404 and be swallowed by the catch, which is the
    // same outcome — but a request fired to be ignored is one an operator
    // watching the network tab has to work out the meaning of, and it is one
    // more thing that looks broken while behaving correctly.
    if (!shelvesTracked) { setRecon(null); setCounts(null); return; }
    try {
      const [r, c] = await Promise.all([
        api.get('/stock/reconciliation').catch(() => null),
        api.get('/stock/counts/pending').catch(() => null),
      ]);
      setRecon(r); setCounts(c?.summary || null);
    } catch { /* quiet */ }
  }, [shelvesTracked]);
  useEffect(() => { refresh(); }, [refresh]);

  const stats = [
    recon && {
      key: 'filed', label: 'Filed variants', value: recon.filed, icon: MapPin, tone: 'var(--secondary)',
      hint: `${recon.unfiled} not on any shelf yet`,
    },
    recon && {
      key: 'gap', label: 'Shelf gap', value: recon.gap_units, icon: TriangleAlert,
      tone: recon.gap_units === 0 ? 'var(--success)' : 'var(--warning)',
      urgent: recon.mismatched > 0,
      hint: recon.mismatched === 0
        ? 'Shelves add up to on-hand'
        : `${recon.mismatched} variant(s) disagree with their shelves`,
    },
    counts && {
      key: 'pending', label: 'Counts to approve', value: counts.pending, icon: Clock,
      tone: counts.pending ? 'var(--warning)' : 'var(--success)', urgent: counts.pending > 0,
    },
    counts && {
      key: 'shrink', label: 'Shrinkage (30d)', value: counts.shrinkage_units, icon: ArrowDown,
      tone: counts.shrinkage_units ? 'var(--danger)' : 'var(--success)',
      hint: counts.found_units ? `${counts.found_units} found in the same window` : 'Units believed to exist that did not',
    },
  ].filter(Boolean);

  if (tabs.length === 0) {
    return (
      <div className="admin-page">
        <PageHeader icon={Boxes} title="Stock operations" subtitle="No stock permissions granted" />
      </div>
    );
  }

  return (
    <div className="admin-page stk-page">
      <PageHeader
        icon={Boxes}
        title="Stock operations"
        subtitle="Count a shelf, book goods in, take goods back"
      >
        <AskAbout
          question="How is stock? What is out of stock or running low, and are there shelf counts waiting for someone to approve them?"
          label="Ask"
          title="Ask the assistant about stock"
        />
        <Link to="/admin/shelves" className="glass-btn glass-btn-sm">
          <MapPin size={14} aria-hidden="true" /> Shelves
        </Link>
      </PageHeader>

      {stats.length > 0 && <StatTiles stats={stats} />}

      <div className="segmented stk-tabs" role="tablist" aria-label="Stock operation">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`segmented-option${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <t.icon size={13} aria-hidden="true" /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'count' && <CountTab canApply={can.adjustStock} onChanged={refresh} />}
      {tab === 'receive' && <ReceiveTab onChanged={refresh} />}
      {tab === 'returns' && <ReturnsTab onChanged={refresh} />}
    </div>
  );
}
