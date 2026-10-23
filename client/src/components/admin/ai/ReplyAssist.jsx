import { useState } from 'react';
import { MessageSquareReply, Replace } from 'lucide-react';
import DraftTool from './DraftTool';
import { useAuth } from '../../../context/AuthContext';
import { hasAdminPermission } from '../../../utils/adminPermissions';

/**
 * A drafted reply, offered under the staff composer on a support ticket.
 *
 * ── Three gates, and only one of them is visible here ──────────────────────
 *
 * 1. **The permission.** `support.reply`, checked here so a staff member with
 *    read-only access is not shown a button that 403s. This is the only gate
 *    the client can evaluate.
 * 2. **The operator's switch**, evaluated inside `DraftTool` like every other
 *    tool.
 * 3. **The BUYER's consent**, which only the server can check and which is the
 *    one most easily got wrong: the person pressing this button is not the
 *    person whose words are being read. `generate.supportDraft` gates on
 *    `allowedForSubject(ticket.user_id, 'support')` for exactly that reason,
 *    and a customer who has not agreed produces a refusal the operator sees as
 *    a sentence rather than a silent empty draft.
 *
 * ── Why the note field is not the reply ───────────────────────────────────
 *
 * The composer above already takes the words that get sent. This field takes
 * the words that do NOT — "offer the refund", "we are out until Tuesday" —
 * and they reach the model as steering, never the customer. It is deliberately
 * placed on the tool and not in the composer, so there is no way to type
 * steering into the box that sends.
 *
 * Internal notes on the ticket are excluded from what the model reads
 * (`generate.supportDraft` filters `is_internal`). That is the single worst
 * failure this feature could have — a draft that quotes "this one is probably
 * a scammer" back at the customer — and it is worth knowing here, because it
 * is also the reason this field exists at all: an operator who wants the model
 * to know something has to say it here, deliberately, rather than assuming it
 * read the notes.
 */
/**
 * ── Why the steering field can be controlled from outside ──────────────────
 *
 * `components/admin/SavedReplies.jsx` offers "draft from it", which hands a
 * saved snippet to this tool as its instruction. That is the more useful half of
 * a snippet library: the snippet states the shop's POLICY, and a model given
 * that policy plus the customer's actual question writes a reply about this
 * order that follows it — rather than a paragraph the staff member then has to
 * personalise by hand.
 *
 * So `notes` is optionally controlled. Uncontrolled is still the default, which
 * keeps every other use of this component unchanged; when the page supplies the
 * pair, the page owns the value and the library can write into it. It
 * deliberately does NOT auto-run the generation — filling the field and pressing
 * the button are two decisions, and spending a model call because somebody
 * clicked a snippet to read it would be the wrong one to merge.
 */
/**
 * ── Three desks, and what actually differs between them ───────────────────
 *
 * The ticket desk had this to itself while it was the only place a reply could
 * be drafted, and the docs had been promising "a ticket, dispute or chat" for
 * as long. Adding the other two as copies of this file would have produced
 * three components agreeing by accident about the thing that matters — that a
 * draft is never sent — so what differs is a table and the rest is written
 * once.
 *
 * The PERMISSION is the entry worth reading twice. It is not `support.reply`
 * for all three, and deliberately: `config/permissions.js` keeps answering
 * tickets, replying in a claim and staffing the chat room apart, and a support
 * agent who may do the first has not been trusted with the second. Each desk
 * checks the grant that already governs speaking there, and the server checks
 * the same one again on the route.
 *
 * The `hint` is the other half. It is the only place an operator is told what
 * the model reads, and that is not uniform either — the chat room is public
 * and multi-author, so what reaches the model there is filtered per author by
 * whoever consented (`generate.DRAFT_DESKS.chat`), and saying so is the
 * difference between a surprising empty draft and an understood one.
 */
const DESKS = {
  ticket: {
    permission: 'support.reply',
    path: (id) => `/ai/support/${id}`,
    label: 'Draft a reply',
    hint: "Reads the customer's messages. Internal notes are never sent to the model.",
  },
  dispute: {
    permission: 'disputes.reply',
    path: (id) => `/ai/disputes/${id}`,
    label: 'Draft a reply',
    // Said out loud because it is the rule an operator would otherwise have to
    // discover by watching what comes back: this desk drafts what to SAY, and
    // the outcome of the claim stays with the person who may resolve it.
    hint: 'Reads the claim thread. It never decides the claim — no refund, no replacement, no closure.',
  },
  chat: {
    permission: 'support.chat',
    path: () => '/ai/chat-reply',
    label: 'Draft a reply',
    hint: 'Reads the recent room — only the messages of people who turned the assistant on.',
  },
};

export default function ReplyAssist({ desk = 'ticket', ticketId, onUse, notes: notesProp, onNotesChange }) {
  const { user } = useAuth();
  const [ownNotes, setOwnNotes] = useState('');
  const controlled = typeof notesProp === 'string' && typeof onNotesChange === 'function';
  const notes = controlled ? notesProp : ownNotes;
  const setNotes = controlled ? onNotesChange : setOwnNotes;

  const spec = DESKS[desk] ?? DESKS.ticket;
  if (!hasAdminPermission(user, spec.permission)) return null;

  return (
    <DraftTool
      capability="support"
      icon={MessageSquareReply}
      label={spec.label}
      hint={spec.hint}
      run={() => ({ path: spec.path(ticketId), body: { notes: notes.trim() || undefined } })}
      renderDraft={(r) => <p className="aidraft-prose">{r.text}</p>}
      acceptNote="…then read it, edit it, and send it yourself."
      actions={[{
        label: 'Put it in the box',
        icon: Replace,
        primary: true,
        onAccept: (r) => onUse(r.text),
      }]}
    >
      <input
        className="aidraft-input"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything it should know? (not sent to the customer)"
        aria-label="Steering for the draft — not sent to the customer"
        maxLength={400}
      />
    </DraftTool>
  );
}
