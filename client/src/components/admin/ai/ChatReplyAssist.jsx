import { useEffect, useRef, useState } from 'react';
import { Check, MessageSquareReply, Pencil, RotateCw, Sparkle, X } from 'lucide-react';
import { useAiTool } from '../../../hooks/useAiTool';
import { useAuth } from '../../../context/AuthContext';
import { useTheme } from '../../../context/ThemeContext';
import { hasAdminPermission } from '../../../utils/adminPermissions';
import ThinkingDial from './ThinkingDial';

/**
 * The draft tool, rebuilt for the one surface where `DraftTool`'s shape is
 * wrong: the live chat room.
 *
 * ── Why this is not just `ReplyAssist desk="chat"` ─────────────────────────
 *
 * It was, and the shape was inherited rather than chosen. `DraftTool` is built
 * for a FORM: a trigger row with a steering field beside it, a slip that opens
 * underneath holding the draft, a thinking dial, a hint sentence, and an accept
 * button that hands the text to a page whose own Save is the commit. On a
 * ticket page — a wide column, a composer the height of a paragraph, an agent
 * who will be there for minutes — that is right, and it stays.
 *
 * The chat widget is a 360px panel pinned to a corner with a message list above
 * a one-line composer. Dropping the same component under that composer cost
 * roughly a third of the visible transcript to a control that is idle almost
 * all of the time, pushed the message list up every time a draft arrived, and
 * put the hint sentence — "Reads the recent room — only the messages of people
 * who turned the assistant on" — permanently on screen in a window whose whole
 * job is showing what somebody just said.
 *
 * DESIGN §7: every control must justify its pixels, and §1's "cards inside
 * cards" is what a full draft panel inside a floating chat panel actually is.
 *
 * ── What it is instead ─────────────────────────────────────────────────────
 *
 * Idle, it is ONE icon button on the composer row, beside the paperclip — the
 * same size, the same row, no extra height at all. It is where a person's hand
 * already is.
 *
 * Pressed, the draft arrives as a strip ABOVE the composer, streaming as it is
 * written, dashed-bordered because that is this app's settled language for
 * "could be" rather than "is" (`styles/core/98-tag-suggestions.css`, and
 * `DraftTool`'s own reasoning). It carries three verbs and no prose:
 *
 *   Use it      the text goes into the composer and the strip closes
 *   Redo        another draft, same steering
 *   ✕           discard
 *
 * The strip is `position: absolute` over the top of the transcript rather than
 * in the flow, so a draft does not shove the conversation upward mid-sentence
 * — the specific failure that made the inherited version unusable while
 * somebody was still typing at you.
 *
 * ── Steering is behind a press, not always on screen ───────────────────────
 *
 * `ReplyAssist`'s note field is the right idea — words that steer the model and
 * are never sent to the customer — and it is used on a minority of drafts. So
 * it is a pencil toggle on the strip's own head rather than a permanent input.
 * The rule it enforces is unchanged and is the reason the field exists at all:
 * there is no way to type steering into the box that SENDS, because this field
 * is not that box.
 *
 * ── It renders INSIDE the composer form, and what that costs ──────────────
 *
 * The trigger has to be a flex child of `.lc-compose` to sit on the row with
 * the paperclip and Send, so this whole component is mounted inside the form
 * and the strip is positioned against it (`.lc-compose` is the containing
 * block; the strip sits at `bottom: 100%`). That buys the layout for free and
 * costs one thing, which is handled explicitly rather than left to be
 * discovered: **a bare Enter in the steering field would submit the form and
 * send a message.** `onKeyDown` stops it and runs the draft instead, which is
 * what pressing Enter in that field obviously means. Every button here carries
 * `type="button"` for the same reason.
 *
 * ── Three gates, unchanged ─────────────────────────────────────────────────
 *
 * 1. `support.chat`, checked here so somebody who cannot speak in the room is
 *    not shown a button that 403s.
 * 2. `ai_chat_reply_assist`, the operator's switch for this room specifically,
 *    off by default — checked on the server (`aiController.chatDraft`) and
 *    mirrored here from the public settings payload so the button is absent
 *    rather than present-and-failing.
 * 3. The `ai.support` capability, evaluated inside `useAiTool` like every other
 *    tool, plus the per-author consent filtering the server does on the window
 *    it reads (`generate.DRAFT_DESKS.chat`). A room where nobody has turned the
 *    assistant on honestly has nothing to draft from, and the empty answer says
 *    so rather than looking broken.
 */
export default function ChatReplyAssist({ onUse }) {
  const { user } = useAuth();
  const { settings } = useTheme();
  const [notes, setNotes] = useState('');
  const [steering, setSteering] = useState(false);
  const bodyRef = useRef(null);

  const tool = useAiTool('support', () => ({
    path: '/ai/chat-reply',
    body: { notes: notes.trim() || undefined },
  }));

  const { busy, error, result, streamed, thinking } = tool;

  // Follow the text as it is written. A strip that streams past its own bottom
  // edge and has to be scrolled back is worse than one that waits, and this is
  // the only place in the app where a draft is read while it arrives rather
  // than after.
  useEffect(() => {
    const el = bodyRef.current;
    if (el && busy) el.scrollTop = el.scrollHeight;
  }, [streamed, busy]);

  // Off for this room, or this viewer may not speak in it. Absent, not
  // disabled — AdminSearch's rule: a greyed control still advertises a feature
  // and still invites a press that goes nowhere.
  if (settings.ai_chat_reply_assist !== 'true') return null;
  if (!hasAdminPermission(user, 'support.chat')) return null;
  // `offered` is undefined until the status lands, and false when the shop has
  // the capability switched off. Neither draws a button.
  if (tool.offered !== true) return null;

  const open = busy || !!result || !!error;
  const text = result?.text ?? streamed;

  const use = () => {
    if (!text) return;
    onUse(text);
    tool.clear();
    setSteering(false);
  };

  return (
    <>
      {open && (
        <div className="lcdraft" role="group" aria-label="Drafted reply" data-reveal>
          <div className="lcdraft-head">
            <span className="lcdraft-title">
              <Sparkle size={11} aria-hidden="true" />
              {busy ? 'Drafting…' : 'Draft — not sent'}
            </span>
            <ThinkingDial
              options={tool.thinkOptions}
              value={tool.thinkLevel}
              onChange={tool.setThinkLevel}
              disabled={busy}
            />
            {!busy && !error && (
              <button
                type="button"
                className={`lcdraft-icon${steering ? ' is-on' : ''}`}
                onClick={() => setSteering((v) => !v)}
                aria-pressed={steering}
                title="Tell it something first — never sent to the customer"
              >
                <Pencil size={12} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="lcdraft-icon"
              onClick={() => { tool.clear(); setSteering(false); }}
              /* Doubles as Stop while a request is in flight: it is a slot on
                 somebody's GPU for up to two minutes, and in a 360px panel a
                 separate Stop button is a third verb competing for the same
                 row. */
              title={busy ? 'Stop' : 'Discard'}
              aria-label={busy ? 'Stop drafting' : 'Discard draft'}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>

          {error && (
            <p className="lcdraft-error" role="status">
              {error.message}
              {error.retryable && (
                <button type="button" className="lcdraft-link" onClick={() => tool.run()}>Try again</button>
              )}
            </p>
          )}

          {/* The working-out, collapsed and never mixed into the draft. A
              reasoning model spends its opening stretch entirely here and emits
              no reply text at all, which in a chat panel is a motionless
              spinner indistinguishable from a dropped connection — so the FACT
              of it shows even though the content stays folded. */}
          {thinking && !streamed && (
            <p className="lcdraft-thinking" aria-hidden="true">Thinking…</p>
          )}

          {(text || busy) && !error && (
            <div className="lcdraft-body" ref={bodyRef}>
              {text}
              {busy && <span className="lcdraft-cursor" aria-hidden="true" />}
            </div>
          )}

          {steering && !busy && (
            <input
              className="glass-input lcdraft-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything it should know? (not sent)"
              aria-label="Steering for the draft — not sent to the customer"
              maxLength={400}
              autoFocus
              /* See the header: this input lives inside the send form, so a
                 bare Enter would post the customer a message. Redraft instead,
                 which is what Enter in a steering field means anyway. */
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                e.stopPropagation();
                tool.run();
              }}
            />
          )}

          {!busy && !error && text && (
            <div className="lcdraft-actions">
              <button type="button" className="glass-btn glass-btn-primary glass-btn-sm" onClick={use}>
                <Check size={12} aria-hidden="true" /> Use it
              </button>
              <button type="button" className="glass-btn glass-btn-sm" onClick={() => tool.run()}>
                <RotateCw size={12} aria-hidden="true" /> Redo
              </button>
              <span className="lcdraft-note">…then read it and send it yourself.</span>
            </div>
          )}
        </div>
      )}

      {/* The idle state: one button, on the composer row, costing no height.
          Rendered by the parent into the form's own row — see LiveChat. */}
      {!open && (
        <button
          type="button"
          className="lc-attach lc-draft-btn"
          onClick={() => tool.run()}
          title="Draft a reply with the assistant — reads the recent room, sends nothing"
          aria-label="Draft a reply with the assistant"
        >
          <MessageSquareReply size={16} aria-hidden="true" />
        </button>
      )}
    </>
  );
}
