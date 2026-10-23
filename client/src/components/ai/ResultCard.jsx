import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, Repeat, Play, ToggleRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';
import { announceOrderChanged } from '../../utils/orderEvents';
import { announceSettingChanged } from '../../utils/settingsEvents';

/**
 * One card for everything the assistant hands back.
 *
 * ── Why one shape ──────────────────────────────────────────────────────────
 *
 * The tools used to return `{ id, title, href, detail }` and the panel drew
 * every one as a link. That was fine for "open the order page" and wrong for
 * "I put three in your cart": a link does not say what changed, and a person
 * reading it back an hour later cannot tell a card that DID something from a
 * card that merely points somewhere. So every card now carries, optionally:
 *
 *   changed   before/after pairs — what the tool actually altered
 *   controls  the one or two places that reverse or adjust it
 *   rows      a fact-by-option table, for a comparison
 *   lines     a list with a note and a tone, for a review or a proposal —
 *             each may carry an href and its own controls
 *
 * The figures in them were computed by the application (server/services/ai/
 * tools.js): prices through the pricing engine, stock from the row. Nothing a
 * model wrote reaches a cell, which is what lets a price be printed here at
 * all.
 *
 * A card with none of those is drawn exactly as before — a single link — so
 * the topics that only ever pointed somewhere still look like themselves.
 *
 * ── Buttons that act, and what a press actually is ─────────────────────────
 *
 * A control with `kind: 'verb'` or `kind: 'swap'` is a staff button. The
 * server put it on the card from the shop's own verb table
 * (`services/botStaff.VERBS`) and only for a verb this viewer may press on
 * this order right now; the bots draw the same button as an `sa:` / `so:`
 * callback. A press here is the ordinary admin request — the same
 * `PUT /orders/:id/status` the queue's own Accept button sends, the same
 * `POST …/swap` the order page sends — and the server re-checks the account,
 * the grant and the order's state on every one. The card is a bearer of
 * nothing; it is a shortcut to a button that is already on another page.
 *
 * A control with `kind: 'setting'` is the same idea for one of the shop's
 * settings (services/ai/settingsIndex.js). The server puts it on the card only
 * for somebody whose own permissions let them change that key, and the press
 * is `PUT /settings { key: value }` — one key, through the Settings page's own
 * endpoint, which checks that permission again, validates the value and writes
 * the audit row. Nothing the model said is sent: the key and value were
 * resolved by the server from the settings index.
 *
 * Two presses, not one: the first arms the button and names what it will do,
 * the second does it. An inline two-step rather than `window.confirm`, for
 * the reason components/profile/SessionList.jsx gives — a dialog the browser
 * is allowed to suppress is a confirmation that silently returns false.
 */
export default function ResultCard({ card, onNavigate }) {
  const rows = Array.isArray(card.rows) ? card.rows : [];
  const columns = Array.isArray(card.columns) ? card.columns : [];
  const lines = Array.isArray(card.lines) ? card.lines : [];
  const changed = Array.isArray(card.changed) ? card.changed : [];
  const controls = Array.isArray(card.controls) ? card.controls : [];
  const plain = !rows.length && !lines.length && !changed.length && !controls.length;

  if (plain) {
    return (
      <Link to={card.href} className="buddy-row buddy-card" onClick={onNavigate}>
        <div className="buddy-card-name">{card.title}</div>
        {card.detail && <div className="buddy-card-brand">{card.detail}</div>}
      </Link>
    );
  }

  return (
    <div className={`buddy-card buddy-result is-${card.kind || 'change'}`}>
      <Link to={card.href} className="buddy-row buddy-result-head" onClick={onNavigate}>
        <div className="buddy-card-name">{card.title}</div>
        {card.detail && <div className="buddy-card-brand">{card.detail}</div>}
      </Link>

      {changed.length > 0 && (
        <dl className="buddy-result-changed">
          {changed.map((c, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <div key={i} className="buddy-result-change">
              <dt>{c.label}</dt>
              <dd>
                <s>{c.before}</s>
                <ArrowRight size={11} aria-hidden="true" />
                <b>{c.after}</b>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {columns.length > 0 && rows.length > 0 && (
        /* Wide content scrolls inside its own box; the panel never does. */
        <div className="buddy-result-table-wrap">
          <table className="buddy-result-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">Fact</span></th>
                {columns.map((c, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <th key={i} scope="col">
                    {c.href ? <Link to={c.href} onClick={onNavigate}>{c.label}</Link> : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                // eslint-disable-next-line react/no-array-index-key
                <tr key={i}>
                  <th scope="row">{r.label}</th>
                  {(r.values || []).map((v, j) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <td key={j} className={v === '—' ? 'is-none' : undefined}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {lines.length > 0 && (
        <ul className="buddy-result-lines">
          {lines.map((l, i) => {
            const lineControls = Array.isArray(l.controls) ? l.controls : [];
            return (
              // eslint-disable-next-line react/no-array-index-key
              <li key={i} className={`is-${l.tone || 'ok'}`}>
                {l.href
                  ? <Link to={l.href} className="buddy-result-line-label" onClick={onNavigate}>{l.label}</Link>
                  : <span className="buddy-result-line-label">{l.label}</span>}
                {l.note && <span className="buddy-result-line-note">{l.note}</span>}
                {lineControls.length > 0 && (
                  <span className="buddy-result-line-controls">
                    {lineControls.map((c, j) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <Control key={j} control={c} onNavigate={onNavigate} />
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {controls.length > 0 && (
        <div className="buddy-result-controls">
          {controls.map((c, i) => (
            // eslint-disable-next-line react/no-array-index-key
            <Control key={i} control={c} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

/** A link, or a button that acts — decided by the control's own `kind`. */
function Control({ control, onNavigate }) {
  if (control.kind === 'verb' || control.kind === 'swap' || control.kind === 'setting') return <ActionButton control={control} />;
  return <Link to={control.href} className="glass-btn glass-btn-sm" onClick={onNavigate}>{control.label}</Link>;
}

/** How long an armed button waits for its second press before standing down. */
const ARM_MS = 6000;

/**
 * The request a control stands for.
 *
 * Written here rather than sent by the server, so the card never tells the
 * browser an arbitrary URL to call: a verb becomes the status endpoint the
 * admin queue already uses, a swap becomes the order page's own offer
 * endpoint, and anything else is not a button.
 */
function requestFor(c) {
  if (c.kind === 'verb' && c.order && c.status) {
    return () => api.put(`/orders/${encodeURIComponent(c.order)}/status`, { status: c.status });
  }
  if (c.kind === 'swap' && c.order && c.item_id && c.variant_id) {
    return () => api.post(`/orders/${encodeURIComponent(c.order)}/items/${encodeURIComponent(c.item_id)}/swap`, {
      variant_id: c.variant_id,
      quantity: c.quantity,
    });
  }
  // One key, shaped the way the server's own key rule shapes it
  // (settingsController SETTINGS_KEY_RE), so a malformed card cannot become a
  // request body with anything else in it.
  if (c.kind === 'setting' && /^[a-z][a-z0-9_]{0,126}$/.test(String(c.key)) && typeof c.value === 'string') {
    return () => api.put('/settings', { [c.key]: c.value });
  }
  return null;
}

function ActionButton({ control }) {
  const [state, setState] = useState('idle'); // idle | armed | busy | done
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  const send = requestFor(control);
  if (!send) return null;

  const press = async () => {
    if (state === 'busy' || state === 'done') return;
    if (state === 'idle') {
      setState('armed');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setState((s) => (s === 'armed' ? 'idle' : s)), ARM_MS);
      return;
    }
    clearTimeout(timer.current);
    setState('busy');
    try {
      await send();
      setState('done');
      if (control.kind === 'setting') {
        toast.success(`${control.setting}: ${control.shown}.`);
        // The Settings page behind this panel holds a copy of every key and
        // saves them all back — see utils/settingsEvents.js for the revert
        // this prevents.
        announceSettingChanged(control.key, control.value);
      } else {
        toast.success(control.kind === 'swap' ? 'Swap offered — the buyer decides.' : `${control.label}: done.`);
        // The queue or the order page behind this panel is now stale. Said
        // once, after the server agreed — see utils/orderEvents.js.
        announceOrderChanged(control.order);
      }
    } catch (err) {
      setState('idle');
      toast.error(err?.message || 'That did not go through.');
    }
  };

  const Icon = control.kind === 'swap' ? Repeat : control.kind === 'setting' ? ToggleRight : Play;
  const label = state === 'armed' ? `Press again to ${control.label.toLowerCase()}`
    : state === 'busy' ? 'Working…'
      : state === 'done' ? `${control.label} — done`
        : control.label;

  return (
    <button
      type="button"
      className={`glass-btn glass-btn-sm buddy-result-act is-${state}`}
      onClick={press}
      disabled={state === 'busy' || state === 'done'}
      aria-live="polite"
      title={control.kind === 'swap'
        ? 'Offers this replacement to the buyer. Nothing changes until they accept.'
        : control.kind === 'setting'
          ? 'Saves this one setting exactly as the Settings page would, and records it in the audit log. Press twice.'
          : 'The same action as the button on the order page. Press twice.'}
    >
      {state === 'done'
        ? <Check size={12} aria-hidden="true" />
        : state === 'busy'
          ? <span className="spinner spinner-inline" aria-hidden="true" />
          : <Icon size={12} aria-hidden="true" />}
      {label}
    </button>
  );
}
