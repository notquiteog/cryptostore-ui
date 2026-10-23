import { useState } from 'react';
import {
  ArrowDownToLine, Languages, PenLine, Replace, Wand2,
} from 'lucide-react';
import DraftTool from './DraftTool';

/**
 * The three things a shop does to a piece of copy, offered under the field it
 * would change.
 *
 * ── Why all three live in one component ────────────────────────────────────
 *
 * Write it, rewrite it, translate it. They are separate endpoints and separate
 * operator switches, but they are one decision — "this paragraph is not right
 * yet" — and an operator who has that thought should not have to find three
 * places. More practically: whichever ones the shop has switched on, the field
 * gets exactly one block under it, and a shop with none gets nothing at all
 * rather than an empty toolbar with a heading.
 *
 * ── Why each tool is one row ───────────────────────────────────────────────
 *
 * Rewrite and translate both take an optional refinement, and both work
 * without it — `prompts.editCopy` defaults to "tidy it up" and
 * `prompts.translate` to English. So the field sits ON the trigger's row, and
 * pressing the trigger with it empty is the common case rather than an error.
 * Stacking the inputs above their buttons made a nine-line block under a
 * four-line textarea, which is how a helper ends up bigger than the thing it
 * helps with.
 *
 * ── Replace and append are both offered, and append is not an afterthought ─
 *
 * A description that already says something true about postage should not be
 * lost because somebody wanted a better opening paragraph. Replace is the
 * primary because it is the common case; append is there because the
 * alternative is copying out of the slip by hand, which people do, and then
 * they stop using the tool.
 */
export default function CopyAssist({
  /** The product group, for the tool that writes from the catalogue. */
  groupId,
  /** The field's current value — what rewrite and translate work from. */
  text,
  /** Hand the draft to the page's own setter. Nothing here saves. */
  onReplace,
  onAppend,
  /** Named in the button so an operator with two fields knows which is which. */
  fieldLabel = 'description',
}) {
  const [instruction, setInstruction] = useState('');
  const [language, setLanguage] = useState('');

  const hasText = Boolean(String(text || '').trim());

  /**
   * `allowAppend` is false for rewrite and translate, and that is not a
   * simplification: both of them return a version OF the current text, so
   * appending one to the other is a description that says everything twice.
   * Only the tool that writes something new from the catalogue can sensibly
   * be added to what is already there.
   */
  const actions = ({ allowAppend = false } = {}) => [
    {
      label: `Use as ${fieldLabel}`,
      icon: Replace,
      primary: true,
      onAccept: (r) => onReplace(r.text),
    },
    ...(allowAppend && onAppend && hasText
      ? [{ label: 'Add to the end', icon: ArrowDownToLine, onAccept: (r) => onAppend(r.text) }]
      : []),
  ];

  // The SERVER's parsed answer, not the tokens that streamed past on the way:
  // `parseProse` strips the code fence a small model wraps prose in and the
  // stray quoting it sometimes adds, and the operator should be offered the
  // cleaned version rather than the raw one they happened to watch arrive.
  const prose = (r) => <p className="aidraft-prose">{r.text}</p>;

  return (
    <>
      {/* Writes from what the catalogue already knows — the product's name,
          its variants and its tags (`generate.loadGroup`). Needs a saved
          product, because there is no group to read for one that has never
          been written. */}
      <DraftTool
        capability="describe"
        icon={Wand2}
        label="Draft from the catalogue"
        hint={groupId ? "Reads this product's name, variants and tags." : undefined}
        disabled={!groupId}
        disabledHint="Create the product first — there is nothing to read yet."
        run={() => ({ path: `/ai/describe/${groupId}` })}
        renderDraft={prose}
        actions={actions({ allowAppend: true })}
      />

      <DraftTool
        capability="edit"
        icon={PenLine}
        label="Rewrite"
        disabled={!hasText}
        disabledHint="Write something first — there is nothing to rewrite."
        run={() => ({ path: '/ai/edit', body: { text, instruction: instruction.trim() || undefined } })}
        renderDraft={prose}
        actions={actions()}
      >
        <input
          className="aidraft-input"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="Tidy it up — or say how (shorter, warmer, less salesy)"
          aria-label="How to rewrite it"
          maxLength={200}
        />
      </DraftTool>

      {/* Translation is a draft like the others rather than a second stored
          column, because this store has no translated-copy schema and inventing
          one here would be a migration disguised as a button. The operator
          takes the translation and does what they were going to do with it. */}
      <DraftTool
        capability="translate"
        icon={Languages}
        label="Translate"
        disabled={!hasText}
        disabledHint="Write something first — there is nothing to translate."
        run={() => ({ path: '/ai/translate', body: { text, language: language.trim() || undefined } })}
        renderDraft={prose}
        actions={actions()}
      >
        <input
          className="aidraft-input"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="Into which language? (English)"
          aria-label="Target language"
          maxLength={40}
        />
      </DraftTool>
    </>
  );
}
