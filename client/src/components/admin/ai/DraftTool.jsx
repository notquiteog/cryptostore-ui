import {
  Brain, Check, RotateCw, Sparkle, X,
} from 'lucide-react';
import { useAiTool } from '../../../hooks/useAiTool';
import ThinkingDial from './ThinkingDial';

/**
 * A staff AI tool: a button that produces a draft, and the slip it lands on.
 *
 * ── The shape is "proposed, not applied", and that is not decoration ───────
 *
 * `server/routes/ai.js` withholds the write deliberately — none of these
 * endpoints saves anything, so a prompt injection that reaches the model still
 * cannot change the catalogue, because a person has to move the text into the
 * form and press the form's own save. This component is the client half of
 * that promise. There is no code path here that writes anywhere: `onAccept`
 * hands the draft to the page's existing setter, and the page's existing save
 * button is still the only thing that commits.
 *
 * A tool that wrote into the field directly would look tidier and would quietly
 * delete the property the server routes were built around.
 *
 * ── Why dashed, and why no sparkles ───────────────────────────────────────
 *
 * `styles/core/98-tag-suggestions.css` already settled the house language for
 * this: a tag the product HAS wears a solid border, a tag it COULD have wears
 * a dashed one — "dashed reads as 'could be', and it survives a theme where
 * the two tints are close and --glow-strength is 0". A draft is the same
 * claim about a paragraph, so it wears the same dashes. That also answers
 * DESIGN §1: the panel is recognisably this admin's own vocabulary rather
 * than the generic gradient-and-sparkle every AI feature ships with, and the
 * one sparkle in the trigger is a size-13 glyph doing the job an icon does.
 *
 * ── What the operator is never asked to guess ─────────────────────────────
 *
 * The button is absent when the shop does not offer the capability, rather
 * than present and failing — an operator should not learn what their own shop
 * has switched on by pressing things. When the server refuses mid-session
 * (`ai_capability_off`, or a permission the client could not see), the tool
 * removes itself rather than staying to be pressed again for the same answer.
 */
export default function DraftTool({
  capability,
  icon: Icon = Sparkle,
  label,
  hint,
  run,
  renderDraft,
  actions = [],
  /**
   * What the slip calls itself. The default is right for the tools that
   * propose a change to a field; the two that only report — the review words
   * and the daily note — say what they actually are, because calling a
   * read-only summary a "draft" invites an operator to look for the save
   * button it does not have.
   */
  slipTitle = 'Draft — nothing is saved yet',
  /** Matches slipTitle: a tool that reports is "reading", not "drafting". */
  busyLabel = 'Drafting…',
  /**
   * What happens after the operator accepts. The default is right for the
   * form surfaces, where a section's own save button is the commit; the
   * ticket composer has no section to save, it has Send, and telling somebody
   * to save a thing that has no save button is worse than saying nothing.
   */
  acceptNote = '…then save the section as usual.',
  /**
   * Rendered on the trigger's own row, before the button — an instruction
   * field, a language, a note. On the row rather than above it because these
   * are all optional refinements of a tool that works with the field empty
   * (`prompts.editCopy` defaults to "tidy it up", `prompts.translate` to
   * English), and stacking an optional input above every trigger turned three
   * one-line tools into a nine-line block under a four-line textarea.
   */
  children,
  /** Set when the trigger cannot run yet, e.g. an unsaved product with no id. */
  disabled = false,
  disabledHint,
  className = '',
}) {
  const tool = useAiTool(capability, run);

  // Undefined means "not known yet". Rendering nothing beats rendering the
  // button and taking it away a moment later, which reads as the interface
  // changing its mind about what it offers.
  if (tool.offered !== true) return null;

  const {
    busy, error, result, streamed, thinking,
  } = tool;

  // While the model is still going, the slip shows what has arrived rather
  // than a spinner. This is the whole reason the routes stream: a reasoning
  // model spends its first stretch entirely in `thinking` and emits no answer
  // text at all, so without this an operator watches a motionless button for
  // a minute and cannot tell it apart from a dropped tunnel.
  const live = busy && (streamed || thinking);

  return (
    <div className={`aidraft ${className}`.trim()}>
      <div className="aidraft-trigger-row">
        {children}
        <button
          type="button"
          className="aidraft-trigger"
          onClick={() => tool.run()}
          disabled={busy || disabled}
          title={disabled ? disabledHint || undefined : hint || undefined}
        >
          {busy
            ? <span className="spinner spinner-inline" aria-hidden="true" />
            : <Icon size={13} aria-hidden="true" />}
          {busy ? busyLabel : label}
        </button>
        {/* One dial for every staff tool, because they all render through this
            shell. Beside the trigger rather than in the result slip: it
            describes how the NEXT draft will be produced, so it has to be
            reachable before there is one. Renders nothing at all unless the
            operator has given this viewer the control. */}
        <ThinkingDial
          options={tool.thinkOptions}
          value={tool.thinkLevel}
          onChange={tool.setThinkLevel}
          disabled={busy || disabled}
        />
        {busy && (
          /* Cancelling is worth a control of its own: the request is a slot on
             somebody's GPU for up to two minutes, and closing the panel is the
             only other way to get it back. */
          <button type="button" className="aidraft-link" onClick={tool.clear}>
            <X size={11} aria-hidden="true" /> Stop
          </button>
        )}
        {hint && !busy && !error && !result && <span className="aidraft-hint">{hint}</span>}
      </div>

      {error && (
        <div className="aidraft-error" role="status">
          <span>{error.message}</span>
          {error.retryable && (
            <button type="button" className="aidraft-link" onClick={() => tool.run()}>
              <RotateCw size={11} aria-hidden="true" /> Try again
            </button>
          )}
          <button type="button" className="aidraft-link" onClick={tool.clear}>
            <X size={11} aria-hidden="true" /> Dismiss
          </button>
        </div>
      )}

      {live && (
        <div className="aidraft-slip is-live" role="group" aria-label={`${label} — in progress`}>
          <div className="aidraft-slip-head">
            <span className="aidraft-slip-title">
              {streamed ? 'Writing…' : 'Working it out…'}
            </span>
          </div>

          {/* The working-out, above the answer and visibly subordinate to it.
              Rendered at all because on a reasoning model it is the only thing
              happening for the first stretch; rendered as its own block, never
              merged into the draft, because it is the model talking to itself
              — false starts included — and an operator must never be offered a
              "use this" button over it. It is dropped the moment the finished
              answer lands. */}
          {thinking && (
            <details className="aidraft-thinking" open={!streamed}>
              <summary>
                <Brain size={11} aria-hidden="true" />
                Working out
              </summary>
              {/* aria-live off: this is a running commentary that would talk
                  over everything else a screen reader is saying. The finished
                  answer is what gets announced. */}
              <p className="aidraft-thinking-text" aria-hidden="true">{thinking}</p>
            </details>
          )}

          {streamed && (
            <div className="aidraft-slip-body">
              <p className="aidraft-prose">
                {streamed}
                <span className="aidraft-cursor" aria-hidden="true" />
              </p>
            </div>
          )}
        </div>
      )}

      {result != null && (
        /* `role="group"` rather than a live region: the draft can be several
           paragraphs, and having a screen reader announce the whole thing the
           instant it lands talks over whatever the operator was doing. The
           heading below names it, and focus order reaches it next. */
        <div className="aidraft-slip" role="group" aria-label={`${label} — ${slipTitle}`}>
          <div className="aidraft-slip-head">
            <span className="aidraft-slip-title">{slipTitle}</span>
            <div className="aidraft-slip-tools">
              <button type="button" className="aidraft-link" onClick={() => tool.run()} disabled={busy}>
                <RotateCw size={11} aria-hidden="true" /> Again
              </button>
              <button type="button" className="aidraft-link" onClick={tool.clear}>
                <X size={11} aria-hidden="true" /> Discard
              </button>
            </div>
          </div>

          <div className="aidraft-slip-body">{renderDraft(result)}</div>

          {/* An action may say which results it applies to. The review digest
              answers "fewer than two reviews" with a result that has no text,
              and a "Publish" button under that sentence is a control nobody
              can press to any effect — `when` lets the action stay off the
              slip rather than be pressed and do nothing. */}
          {actions.filter((a) => !a.when || a.when(result)).length > 0 && (
            <div className="aidraft-slip-actions">
              {actions.filter((a) => !a.when || a.when(result)).map((a) => (
                <button
                  key={a.label}
                  type="button"
                  className={`aidraft-accept${a.primary ? ' is-primary' : ''}`}
                  onClick={() => { a.onAccept(result); tool.clear(); }}
                >
                  {a.icon
                    ? <a.icon size={12} aria-hidden="true" />
                    : <Check size={12} aria-hidden="true" />}
                  {a.label}
                </button>
              ))}
              {/* Said once per slip rather than once per page: the operator is
                  about to press something that changes a field, and the fact
                  that it still is not committed is the thing they need at
                  exactly that moment. */}
              <span className="aidraft-slip-note">{acceptNote}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
