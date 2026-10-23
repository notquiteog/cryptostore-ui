import { useState } from 'react';
import { ClipboardPaste, Check, AlertTriangle, ChevronRight, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';

/**
 * Paste a day's tracking numbers into the Ship desk.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * Recording tracking one parcel at a time is fine for five and is the whole
 * afternoon at fifty. Every label printer, carrier console and postage
 * aggregator already produces the list — a reference, a carrier, a number per
 * row — so the dispatcher's real job at the end of a big day is getting that
 * list into the shop. Retyping it is the work, and retyping is where a digit
 * lands on the wrong order.
 *
 * ── Preview first, always ───────────────────────────────────────────────────
 *
 * Two steps, and the first one writes nothing. That is not caution for its own
 * sake: a mis-read reference attaches a number to the wrong order, the buyer is
 * handed somebody else's parcel reference, and a carrier's public page shows
 * that parcel's DESTINATION. So it is an address leak with a delivery estimate
 * on it, and the control is a dispatcher reading "line 4 → order 1042, USPS,
 * 9400…" before anything happens.
 *
 * The preview also resolves every reference against real orders, so "no order
 * starting a1b2c3d4" and "that order is still paid" are answered before the
 * import rather than halfway through it.
 *
 * ── Why the import re-reads the text ────────────────────────────────────────
 *
 * The apply call posts the TEXT again, not the rows the preview returned. A
 * client that could post `{order_id, tracking_number}` pairs would be a client
 * that decides which order a number lands on — exactly the decision the parser
 * and the resolver exist to make carefully. The preview is a reading of what
 * the import will do, never an instruction to it.
 *
 * ── §6: which list shape ────────────────────────────────────────────────────
 *
 * Line items, not a table and not cards. Every row is four short fields and is
 * read DOWN a single axis — "which lines are not ready" — and the failure
 * states need room for a sentence rather than a cell. At phone width the row
 * wraps rather than collapsing into a card, because a dispatcher on a phone is
 * scanning for the red ones and a stack of cards shows three at a time.
 */
export default function TrackingImport({ onImported }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const reset = () => { setText(''); setPreview(null); setDone(null); };

  const check = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setDone(null);
    try {
      setPreview(await api.post('/fulfilment/ship/tracking/preview', { text }));
    } catch (err) {
      toast.error(err.message || 'Could not read those lines');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setBusy(true);
    try {
      const res = await api.post('/fulfilment/ship/tracking/import', { text });
      setDone(res);
      setPreview(null);
      // The queue changes — an order that had no number may now ship — so the
      // desk reloads rather than waiting for its 45-second poll.
      if (res.added > 0) {
        toast.success(`${res.added} tracking number${res.added === 1 ? '' : 's'} recorded`);
        onImported?.();
      }
      // Said out loud rather than left to be inferred from a count. A paste
      // where nothing landed is the case a dispatcher most needs explained.
      if (res.added === 0) toast.error('Nothing was recorded — check the reasons below');
    } catch (err) {
      toast.error(err.message || 'Could not import those lines');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="glass-btn glass-btn-sm" onClick={() => setOpen(true)}>
        <ClipboardPaste size={14} aria-hidden="true" /> Paste tracking numbers
      </button>
    );
  }

  const rows = done?.results || preview?.rows || [];

  return (
    <div className="glass-card tki" role="region" aria-label="Bulk tracking import">
      <div className="tki-head">
        <h3 className="tki-title"><ClipboardPaste size={15} aria-hidden="true" /> Paste tracking numbers</h3>
        <button
          type="button"
          className="tki-close"
          onClick={() => { setOpen(false); reset(); }}
          aria-label="Close the tracking paste"
        >
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <p className="tki-lede">
        One parcel per line: the order reference, the carrier, and the tracking number — in any
        order, separated by tabs, commas or two spaces. A header row is skipped. The order
        reference is the short code on each card, the full reference, or the order number.
      </p>

      <textarea
        className="glass-input tki-text"
        value={text}
        onChange={(e) => { setText(e.target.value); setPreview(null); setDone(null); }}
        rows={6}
        spellCheck={false}
        placeholder={'A1B2C3D4\tUSPS\t9400111899223197428490\n1042, Royal Mail, AB123456789GB'}
        aria-label="Tracking lines"
      />

      <div className="tki-actions">
        <button type="button" className="glass-btn glass-btn-sm" onClick={check} disabled={busy || !text.trim()}>
          {busy && !done ? 'Checking…' : <>Check these lines <ChevronRight size={13} aria-hidden="true" /></>}
        </button>
        {/* Only once the lines have been read, and only when at least one is
            ready. A button that imports nothing is one a dispatcher presses and
            then has to work out why nothing happened. */}
        {preview && preview.ready > 0 && (
          <button type="button" className="glass-btn glass-btn-primary glass-btn-sm" onClick={apply} disabled={busy}>
            <Check size={13} aria-hidden="true" />
            {busy ? 'Recording…' : `Record ${preview.ready} number${preview.ready === 1 ? '' : 's'}`}
          </button>
        )}
        {(preview || done) && (
          <button type="button" className="glass-btn glass-btn-sm" onClick={reset}>Clear</button>
        )}
      </div>

      {preview?.truncated && (
        <p className="tki-note">
          Only the first {preview.max_rows} lines were read. Paste the rest afterwards.
        </p>
      )}
      {preview?.skipped_header && <p className="tki-note">The first line looked like a header and was skipped.</p>}

      {done && (
        <p className="tki-summary">
          {done.added} recorded
          {done.already > 0 && `, ${done.already} already on their order`}
          {done.skipped > 0 && `, ${done.skipped} repeated in the paste`}
          {done.failed > 0 && `, ${done.failed} could not be recorded`}.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="tki-rows">
          {rows.map((r) => (
            <li key={`${r.line}-${r.number || r.text}`} className="tki-row" data-outcome={r.outcome}>
              <span className="tki-line">{r.line}</span>
              <span className="tki-order">
                {r.order_uuid ? r.order_uuid.split('-')[0].toUpperCase() : <em>no order</em>}
              </span>
              <span className="tki-carrier">{r.carrier?.label || '—'}</span>
              <span className="tki-number">{r.number || <em>—</em>}</span>
              <span className="tki-outcome">
                {r.outcome === 'ready' && <><Check size={12} aria-hidden="true" /> ready</>}
                {r.outcome === 'added' && <><Check size={12} aria-hidden="true" /> recorded</>}
                {r.outcome === 'already' && 'already recorded'}
                {(r.outcome === 'error' || r.outcome === 'duplicate') && (
                  <><AlertTriangle size={12} aria-hidden="true" /> {r.error}</>
                )}
              </span>
              {/* The line as pasted, on the rows that failed. A complaint about
                  line 4 is only actionable if the dispatcher can see line 4
                  without counting down their clipboard. */}
              {(r.outcome === 'error' || r.outcome === 'duplicate') && (
                <code className="tki-raw">{r.text}</code>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* A carrier the registry does not recognise is still recorded — the
          number is what matters and the worker simply will not poll it. Said
          here because an operator shipping with a local courier would otherwise
          think the paste had failed. */}
      {preview && preview.ready > 0 && (
        <p className="tki-note">
          A carrier nothing recognises is still recorded; the shop just will not ask it for updates.
          Buyers are told a carrier has their parcel, never the number.
        </p>
      )}
    </div>
  );
}
