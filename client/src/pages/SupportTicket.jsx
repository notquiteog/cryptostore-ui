import SupportOrderTools from '../components/order/SupportOrderTools';
import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../utils/api';
import toast from 'react-hot-toast';
import Avatar from '../components/Avatar';
import ArmoredText from '../components/pgp/ArmoredText';
import ReplyAssist from '../components/admin/ai/ReplyAssist';
import FaqAssist from '../components/admin/ai/FaqAssist';
import SavedReplies from '../components/admin/SavedReplies';
import {
  Send, Paperclip, ArrowLeft, Package, StickyNote,
  Timer, User, Lock, Link2, Unlink, Flag, ShieldAlert, Check,
} from 'lucide-react';
import { ParcelChip } from '../components/order/ParcelStatus';
import TicketAttachment from '../components/support/TicketAttachment';

const STATUSES = ['open', 'awaiting_reply', 'resolved', 'closed'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const statusBadge = (status) => ({
  open: 'badge-primary',
  awaiting_reply: 'badge-warning',
  resolved: 'badge-success',
  closed: 'badge-muted',
}[status] || 'badge-muted');

const prettify = (value) => String(value || '').replace(/_/g, ' ');
const money = (value) => `$${Number(value || 0).toFixed(2)}`;

function shortAge(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function waitLevel(hours) {
  if (hours < 6) return 'is-fresh';
  if (hours < 24) return 'is-warm';
  if (hours < 72) return 'is-hot';
  return 'is-critical';
}

/**
 * The order behind the ticket, and the control that changes it.
 *
 * Linking after the fact is the piece that was missing: a ticket could only
 * ever carry the order it was created with, so a customer who forgot to attach
 * one had to open a second ticket. The server re-runs creation's ownership
 * check on every change, and anchors it on the *ticket owner* — so staff can
 * fix up a link without being able to bolt someone else's order onto it.
 */
function OrderPanel({ ticket, canEdit, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [choices, setChoices] = useState(null);
  const [choice, setChoice] = useState(String(ticket.order_id || ''));
  const [saving, setSaving] = useState(false);

  const order = ticket.order;

  const startEditing = async () => {
    setEditing(true);
    setChoice(String(ticket.order_id || ''));
    if (choices) return;
    try {
      const data = await api.get(`/support/${ticket.id}/linkable-orders`);
      setChoices(data.orders || []);
    } catch (err) {
      toast.error(err.message);
      setChoices([]);
    }
  };

  const save = async (value) => {
    setSaving(true);
    try {
      const data = await api.put(`/support/${ticket.id}/order`, {
        order_id: value === '' ? null : Number(value),
      });
      toast.success(data.message);
      setEditing(false);
      onChanged({ order_id: data.order_id, order_uuid: data.order_uuid, order: data.order });
    } catch (err) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  return (
    <section className="glass-card">
      <h3 className="asup-panel-title"><Package size={16} aria-hidden="true" /> Related order</h3>

      {order ? (
        <div className="asup-order">
          <div className="asup-order-head">
            <Link to={`/orders/${order.uuid}`} className="asup-order-link" title={order.uuid}>
              <Package size={12} aria-hidden="true" />
              {order.uuid.slice(0, 8)}
            </Link>
            <span className="badge badge-muted">{prettify(order.status)}</span>
            <ParcelChip parcels={order.parcels} compact />
          </div>
          <div className="asup-order-facts">
            <span>Total <b>{order.total_redacted ? 'Hidden' : money(order.total)}</b></span>
            <span>Items <b>{order.item_count ?? '—'}</b></span>
            <span>Placed <b>{order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}</b></span>
          </div>
        </div>
      ) : (
        <div className="asup-order-empty">Nothing linked yet.</div>
      )}

      {canEdit && !editing && (
        <div className="asup-orderedit">
          <button className="glass-btn glass-btn-sm" onClick={startEditing}>
            <Link2 size={14} aria-hidden="true" /> {order ? 'Change order' : 'Link an order'}
          </button>
        </div>
      )}

      {canEdit && editing && (
        <div className="asup-orderedit admin-panel-in">
          {choices === null ? (
            <span className="admin-hint"><span className="spinner spinner-inline" /> Loading orders…</span>
          ) : (
            <select
              className="glass-input"
              value={choice}
              onChange={e => setChoice(e.target.value)}
              aria-label="Order to link to this ticket"
            >
              <option value="">No order</option>
              {choices.map(o => (
                <option key={o.id} value={o.id}>
                  {o.uuid.slice(0, 8)} — {prettify(o.status)} — {o.total_redacted ? 'hidden' : money(o.total)}
                  {' — '}{new Date(o.created_at).toLocaleDateString()}
                </option>
              ))}
            </select>
          )}
          <div className="asup-orderedit-actions">
            <button
              className="glass-btn glass-btn-sm glass-btn-primary"
              disabled={saving || choices === null}
              onClick={() => save(choice)}
            >
              {saving ? <><span className="spinner spinner-inline" /> Saving…</> : 'Save'}
            </button>
            {order && (
              <button className="glass-btn glass-btn-sm" disabled={saving} onClick={() => save('')}>
                <Unlink size={14} aria-hidden="true" /> Unlink
              </button>
            )}
            <button className="glass-btn glass-btn-sm" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Staff-only. Never rendered for a customer: the server omits `customer`. */
function CustomerPanel({ customer }) {
  return (
    <section className="glass-card">
      <h3 className="asup-panel-title"><User size={16} aria-hidden="true" /> Customer</h3>

      <div className="asup-who" style={{ marginBottom: 'var(--sp-3)' }}>
        <strong>{customer.username || 'Deleted account'}</strong>
        {customer.tier_name && (
          <span
            className="asup-tier"
            style={customer.tier_color ? { '--asup-tier': customer.tier_color } : undefined}
          >
            {customer.tier_name}
            {customer.tier_discount_pct ? ` · ${customer.tier_discount_pct}%` : ''}
          </span>
        )}
      </div>

      <div className="asup-ctx">
        <div className="asup-ctx-cell">
          <span className="asup-ctx-label">Lifetime</span>
          <span className={`asup-ctx-value${customer.spend_redacted ? ' is-hidden' : ''}`}>
            {customer.spend_redacted ? 'Hidden' : money(customer.lifetime_spend)}
          </span>
        </div>
        <div className="asup-ctx-cell">
          <span className="asup-ctx-label">Orders</span>
          <span className="asup-ctx-value">{customer.order_count}</span>
        </div>
        <div className="asup-ctx-cell">
          <span className="asup-ctx-label">Other tickets</span>
          <span className={`asup-ctx-value${customer.other_open_tickets > 0 ? ' is-watch' : ''}`}>
            {customer.other_open_tickets}
          </span>
        </div>
        <div className="asup-ctx-cell">
          <span className="asup-ctx-label">Disputes</span>
          <span className={`asup-ctx-value${customer.active_dispute_count > 0 ? ' is-alert' : ''}`}>
            {customer.active_dispute_count}
          </span>
        </div>
      </div>

      {customer.member_since && (
        <p className="admin-hint" style={{ marginTop: 'var(--sp-3)', marginBottom: 0 }}>
          Member since {new Date(customer.member_since).toLocaleDateString()}
        </p>
      )}
    </section>
  );
}

export default function SupportTicket() {
  const { id } = useParams();
  const { user } = useAuth();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  // The instruction for the AI reply draft, owned here rather than inside
  // `ReplyAssist`, so the saved-reply library can write into it — "draft from
  // it" hands a snippet to the draft tool as steering. See that component.
  const [draftNotes, setDraftNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [internal, setInternal] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const messagesEnd = useRef(null);

  useEffect(() => { loadTicket(); }, [id]);
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [ticket?.messages]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);

  const loadTicket = async () => {
    setLoading(true);
    try {
      const data = await api.get(`/support/${id}`);
      setTicket(data);
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  /**
   * Is the composer armed to file an internal note?
   *
   * Two ways in: the staff member flipped the toggle, or the ticket is closed —
   * which takes no more conversation, so a note is the only thing that can
   * still be filed against it. Defined as a function rather than derived below
   * the early returns because `sendReply` has to read exactly what the composer
   * is painting, and the two drifting apart is how a note becomes a reply.
   */
  const isArmedInternal = () =>
    !!ticket?.can_post_internal && (internal || ticket?.status === 'closed');

  const sendReply = async (e) => {
    e.preventDefault();
    if (!reply.trim()) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append('body', reply);
      // Read the same armed state the composer paints, not the raw toggle: a
      // closed ticket locks the composer into note mode without the toggle ever
      // being flipped, and sending the toggle alone posted a public reply the
      // server then refused as "cannot reply to a closed ticket".
      //
      // The server forces the flag to false for anyone who cannot post staff
      // replies regardless, so a stale client cannot smuggle it onto a
      // customer's message.
      if (isArmedInternal()) fd.append('is_internal', 'true');
      for (const f of files) fd.append('attachments', f);
      await api.upload(`/support/${id}/reply`, fd);
      setReply('');
      setFiles([]);
      // `internal` is deliberately left armed. The two failure modes are not
      // symmetric: a second note that should have been a reply is an annoyance,
      // a second reply that should have been a note is a leak. The composer
      // stays visibly tinted and banner-ed while it is armed.
      loadTicket();
    } catch (err) {
      toast.error(err.message);
    }
    setSending(false);
  };

  const setStatus = async (next) => {
    try {
      await api.put(`/support/${id}/status`, { status: next });
      toast.success(`Ticket ${prettify(next)}`);
      setTicket(prev => (prev ? { ...prev, status: next } : prev));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const setPriority = async (next) => {
    try {
      await api.put(`/support/${id}/priority`, { priority: next });
      toast.success(`Priority set to ${next}`);
      setTicket(prev => (prev ? { ...prev, priority: next } : prev));
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return (
      <div className="page container asup-detail">
        <div className="skeleton skeleton-row" style={{ height: 34, maxWidth: 180 }} />
        <div className="skeleton asup-skel" style={{ marginTop: 'var(--sp-4)' }} />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="page container asup-detail">
        <div className="glass-card empty-state is-error">
          <ShieldAlert aria-hidden="true" />
          <h3>Ticket not found</h3>
          <p>It may have been removed, or it belongs to another account.</p>
          <Link className="glass-btn" to="/support">Back to tickets</Link>
        </div>
      </div>
    );
  }

  // Which surface this is comes from the server, not from `user.role`: a
  // manager with no support grant reading a ticket of their own is a customer
  // here, and sending them to /admin/support would just bounce them back.
  const staffView = !!ticket.is_staff_view;
  const isOwner = ticket.user_id === user?.id;
  const canEditOrder = (isOwner || ticket.can_manage) && ticket.status !== 'closed';
  const canPostInternal = !!ticket.can_post_internal;
  const composerOpen = ticket.status !== 'closed' || canPostInternal;
  // A closed ticket takes no more conversation, so the only thing staff can
  // still file against it is an internal note — the composer is therefore
  // *locked* into that mode rather than offering a reply the server will 400.
  const lockedInternal = canPostInternal && ticket.status === 'closed';
  const armed = isArmedInternal();

  const waitMs = ticket.waiting_since ? now - new Date(ticket.waiting_since).getTime() : null;

  return (
    <div className="page container asup-detail">
      <Link className="asup-back" to={staffView ? '/admin/support' : '/support'}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to tickets
      </Link>

      <header className="asup-head">
        <div>
          <h2>{ticket.subject}</h2>
          <div className="asup-head-chips">
            <span className={`badge ${statusBadge(ticket.status)}`}>{prettify(ticket.status)}</span>
            {staffView && (
              <span className={`asup-prio ${ticket.priority === 'urgent' ? 'is-urgent' : ticket.priority === 'high' ? 'is-high' : ticket.priority === 'low' ? 'is-low' : 'is-normal'}`}>
                <Flag size={11} aria-hidden="true" /> {ticket.priority || 'normal'}
              </span>
            )}
            {waitMs !== null ? (
              <span className={`asup-clock ${waitLevel(waitMs / 3600000)}`}>
                <Timer size={11} aria-hidden="true" /> waiting {shortAge(waitMs)}
              </span>
            ) : (
              <span className="asup-clock">
                <Timer size={11} aria-hidden="true" /> updated {shortAge(now - new Date(ticket.updated_at).getTime())} ago
              </span>
            )}
            <span className="asup-id">#{ticket.id} · opened {new Date(ticket.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        {ticket.can_manage && (
          <div className="asup-controls">
            <label htmlFor="asup-detail-priority">Priority</label>
            <select
              id="asup-detail-priority"
              className="glass-input asup-select"
              value={ticket.priority || 'normal'}
              onChange={e => setPriority(e.target.value)}
            >
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <label htmlFor="asup-detail-status">Status</label>
            <select
              id="asup-detail-status"
              className="glass-input asup-select"
              value={ticket.status}
              onChange={e => setStatus(e.target.value)}
            >
              {STATUSES.map(s => <option key={s} value={s}>{prettify(s)}</option>)}
            </select>
          </div>
        )}

        {/* ── The customer's own half of the status control ──
            One move, not a dropdown: an owner may mark their thread resolved
            and nothing else. Closing is a staff judgement, and a select
            offering four options where three would 403 is a control that
            teaches people it is broken.

            Offered only while the thread is live and only on an ordinary
            ticket — a dispute's thread closes when the dispute is settled, so
            a button here would promise something the server refuses (see
            supportController.OWNER_TRANSITIONS).

            Reopening is automatic: any new message from the customer sets the
            ticket back to `open`, which is what makes this safe to offer at
            all — the cost of a premature resolve is one message, not a lost
            conversation. The copy says so, or somebody sits on a problem
            rather than risk dismissing it. */}
        {!staffView && ticket.kind !== 'dispute'
          && ['open', 'awaiting_reply'].includes(ticket.status) && (
          <div className="asup-detail-owner-actions">
            <button
              type="button"
              className="glass-btn glass-btn-sm glass-btn-success"
              onClick={() => setStatus('resolved')}
            >
              <Check size={14} aria-hidden="true" /> This is sorted
            </button>
            <span className="asup-detail-owner-hint">
              Closes the ticket for staff. Writing again reopens it.
            </span>
          </div>
        )}
      </header>

      <div className="asup-layout">
        <div>
          <div className="asup-thread">
            {ticket.messages.map((msg, idx) => {
              const isMe = msg.username === user?.username;
              const classes = [
                'glass-card', 'asup-msg',
                msg.is_internal ? 'is-internal' : isMe ? 'is-mine' : 'is-theirs',
              ].join(' ');
              return (
                <div
                  key={msg.id}
                  className={classes}
                  style={{
                    '--i': Math.min(idx, 9),
                    '--asup-tone': msg.is_staff ? 'var(--primary)' : 'var(--success)',
                  }}
                >
                  <div className="asup-msg-head">
                    <span className="asup-msg-who">
                      {/* The face, hoverable for the same card it opens
                          everywhere else. On a ticket the card is doing real
                          work for staff: tenure and order count are exactly
                          what decides how a complaint gets answered, and they
                          were previously two clicks away in the user admin. */}
                      <Avatar username={msg.username} avatarPath={msg.avatar_path} size={22} />
                      {msg.username || 'Unknown'}
                      {msg.is_internal
                        ? <span className="asup-flag is-internal"><Lock size={9} aria-hidden="true" /> Internal note</span>
                        : msg.is_staff ? <span className="asup-flag is-staff">Staff</span> : null}
                    </span>
                    <span>{new Date(msg.created_at).toLocaleString()}</span>
                  </div>
                  {/* A pasted encrypted block — a customer re-sending their
                      sealed address — is drawn as a block, with the audited
                      decrypt for staff who may read addresses. Plain text
                      renders exactly as before. */}
                  <ArmoredText as="div" className="asup-msg-body" text={msg.body} context={`support ticket ${ticket.id}`} />
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="asup-msg-atts">
                      {msg.attachments.map(att => (
                        <TicketAttachment key={att.id} att={att} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={messagesEnd} />
          </div>

          {composerOpen ? (
            <div className={`glass-card asup-composer${armed ? ' is-internal' : ''}`}>
              {armed && (
                <div className="asup-composer-warn">
                  <Lock size={14} aria-hidden="true" />
                  Internal note — visible to staff only. The customer is not notified and never sees it.
                </div>
              )}
              {ticket.status === 'closed' && (
                <>
                  <p className="admin-hint">
                    This ticket is closed. Only internal notes can still be filed against it.
                  </p>
                  {/* The one thing a closed ticket is still good for besides a
                      note: the answer in it is finished, and the next person to
                      ask the same question should find it on the FAQ page
                      instead of opening a ticket. Draft only — see the
                      component, and `server/services/ai/generate.js` on why a
                      write path from a customer-authored conversation to a
                      public page is the one thing this must not have. */}
                  <FaqAssist ticketId={ticket.id} closed />
                </>
              )}
              <form onSubmit={sendReply}>
                <div className="form-group">
                  <textarea
                    className="glass-input"
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    placeholder={armed ? 'Write a note for the team…' : 'Type your reply…'}
                    rows={3}
                    required
                  />
                  {/* Only while the composer sends to the CUSTOMER. Armed for
                      an internal note, the box saves something the customer
                      never sees, and a tool that drafts a customer-facing
                      reply into it would be proposing the right words for the
                      wrong destination — the one confusion this composer
                      already spends a warning banner preventing. */}
                  {/* The library and the draft tool, in that order.
                      The snippet library comes first because it is the cheap
                      path — a pasted answer costs nothing and answers most
                      tickets — and "draft from it" is the bridge between the
                      two: the shop's policy becomes the instruction for a reply
                      about this particular order. See components/admin/SavedReplies. */}
                  {!armed && (
                    <SavedReplies
                      onInsert={(text) => setReply((prev) => (prev.trim() ? `${prev.trimEnd()}\n\n${text}` : text))}
                      onDraftFrom={(text) => setDraftNotes(text)}
                    />
                  )}
                  {!armed && (
                    <ReplyAssist
                      ticketId={ticket.id}
                      onUse={setReply}
                      notes={draftNotes}
                      onNotesChange={setDraftNotes}
                    />
                  )}
                </div>
                <div className="asup-composer-row">
                  <label className="asup-attach">
                    <Paperclip size={16} aria-hidden="true" />
                    <input type="file" multiple accept="image/*,video/*" style={{ display: 'none' }}
                      onChange={e => setFiles([...e.target.files])} />
                    {files.length > 0 ? `${files.length} file(s)` : 'Attach files'}
                  </label>
                  <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
                    {canPostInternal && (
                      <button
                        type="button"
                        className={`glass-btn glass-btn-sm${armed ? ' glass-btn-active' : ''}`}
                        aria-pressed={armed}
                        disabled={lockedInternal}
                        onClick={() => setInternal(v => !v)}
                        title={lockedInternal
                          ? 'A closed ticket only accepts internal notes'
                          : 'Internal notes are never shown to the customer'}
                      >
                        <StickyNote size={14} aria-hidden="true" /> {armed ? 'Internal note' : 'Make internal'}
                      </button>
                    )}
                    <button type="submit" className="glass-btn glass-btn-primary" disabled={sending}>
                      {sending
                        ? <><span className="spinner spinner-inline" /> Sending…</>
                        : <><Send size={16} aria-hidden="true" /> {armed ? 'Save note' : 'Send'}</>}
                    </button>
                  </div>
                </div>
              </form>
            </div>
          ) : (
            <div className="glass-card">
              <p className="admin-hint" style={{ marginBottom: 0 }}>
                This ticket is closed. Open a new one if you still need a hand.
              </p>
            </div>
          )}
        </div>

        <aside className="asup-rail">
          {staffView && canPostInternal && ticket.order_id && ticket.status !== 'closed' && <SupportOrderTools key={ticket.order_id} ticket={ticket} onChanged={() => api.get(`/support/${id}`).then(setTicket)} />}
          <OrderPanel
            ticket={ticket}
            canEdit={canEditOrder}
            onChanged={(patch) => setTicket(prev => (prev ? { ...prev, ...patch } : prev))}
          />
          {ticket.customer && <CustomerPanel customer={ticket.customer} />}
        </aside>
      </div>
    </div>
  );
}
