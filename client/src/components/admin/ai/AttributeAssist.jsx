import { useState } from 'react';
import { MessageSquareQuote, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import DraftTool from './DraftTool';
import { api } from '../../../utils/api';

/**
 * What buyers actually called this variant, with the count that supports each
 * word.
 *
 * ── The "use it" button this file used to refuse, and what changed ─────────
 *
 * This panel had no accept action, and its comment explained why at length:
 * these words are VARIANT-scoped, which is the whole value of them. "Six
 * buyers called the Blueberry one fruity" is true; moving "fruity" up to the
 * product's tags — the only tag field this editor exposed — asserts that every
 * flavour is fruity, which is false and which buyers filter on. `variant_tags`
 * was in the schema and written only by the ingest API, so there was no honest
 * destination. The comment ended: *if a variant-tag editor ever lands, the
 * accept action belongs there and nowhere else.*
 *
 * It landed. `PUT /products/variants/:id/tags` writes this variant's own tags,
 * and that is where these words go — at the scope they were computed at, never
 * up to the product.
 *
 * The destination matters as much as the button. That endpoint is an ORDINARY
 * catalogue route under `products.edit`, not a route in `routes/ai.js`, whose
 * header states the property being protected: every staff AI route returns a
 * draft and none of them saves, so a successful prompt injection cannot change
 * the catalogue. The model proposes; a human presses a button that posts
 * somewhere the model cannot reach, with their own permission.
 *
 * Accepted words are written as `Buyers say = <word>`, so they group under
 * their own heading on the product page rather than mixing with the
 * operator's own specifications — a buyer can see which claims came from other
 * buyers, and the page prints the supporting count beside each one.
 *
 * ── Why the count is shown and not a score ────────────────────────────────
 *
 * The number beside each word is how many of the read reviews contain its
 * stem. Crude on purpose, and the server says why: it is checkable by eye,
 * which a similarity score is not. An operator who doubts "fruity — 6 of 18"
 * can go and read eighteen reviews and settle it. That is the difference
 * between a suggestion and an assertion.
 */
export default function AttributeAssist({ variantId, existingTags = [], onSaved }) {
  // Which suggested words the operator has ticked. Local to the slip: nothing
  // is written until they press Apply, which is the promise DraftTool's own
  // header makes about every tool in this family.
  const [picked, setPicked] = useState(() => new Set());
  const [saving, setSaving] = useState(false);

  const toggle = (word) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(word)) next.delete(word); else next.add(word);
    return next;
  });

  const apply = async () => {
    if (!picked.size || !variantId) return;
    setSaving(true);
    try {
      // The variant's EXISTING tags come along, because the endpoint replaces
      // the whole set rather than appending — see setVariantTags on why one
      // write beats an append plus a delete. Sending only the new words would
      // silently drop whatever the ingest API had put there.
      const additions = [...picked].map((w) => `Buyers say = ${w}`);
      const merged = [...existingTags, ...additions];
      const res = await api.put(`/products/variants/${variantId}/tags`, { tags: merged });
      toast.success(`Added ${picked.size} word${picked.size === 1 ? '' : 's'} to this option`);
      setPicked(new Set());
      onSaved?.(res.tags || merged);
    } catch (err) {
      toast.error(err.message || 'Could not save those tags');
    }
    setSaving(false);
  };

  return (
    <DraftTool
      capability="tags"
      icon={MessageSquareQuote}
      label="What buyers call it"
      hint="Reads this variant's own reviews. Nothing is written."
      slipTitle="What the reviews say"
      busyLabel="Reading reviews…"
      disabled={!variantId}
      disabledHint="Save the variant first — it has no reviews yet."
      run={() => ({ path: `/ai/attributes/${variantId}`, method: 'GET' })}
      renderDraft={(res) => {
        if (!res?.enough) {
          return (
            <p className="aidraft-prose">
              {res?.reviewCount
                ? `Only ${res.reviewCount} review${res.reviewCount === 1 ? '' : 's'} with enough text to read. `
                : 'No reviews with enough text to read yet. '}
              A quality drawn from one review is that reviewer&apos;s opinion, not the product&apos;s.
            </p>
          );
        }
        return (
          <>
            <div className="aidraft-chips">
              {res.attributes.map((a) => {
                const on = picked.has(a.word);
                return (
                  // Buttons now, because there is somewhere to press them into
                  // — this variant's own tags. They were deliberately static
                  // while there was not; a control that looks pressable and
                  // does nothing is worse than a label.
                  <button
                    type="button"
                    key={a.word}
                    className={`aidraft-chip${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggle(a.word)}
                    title={`${a.supporting} of the ${a.of} reviews read contain this word`}
                  >
                    {on && <Check size={11} aria-hidden="true" />}
                    <span>{a.word}</span>
                    <span className="aidraft-chip-count">{a.supporting}/{a.of}</span>
                  </button>
                );
              })}
            </div>
            {picked.size > 0 && (
              <button
                type="button"
                className="glass-btn glass-btn-sm glass-btn-primary"
                style={{ marginTop: 'var(--sp-2)' }}
                disabled={saving}
                onClick={apply}
              >
                <Check size={13} aria-hidden="true" />
                {saving ? 'Saving…' : `Add ${picked.size} to this option's tags`}
              </button>
            )}
            <p className="aidraft-slip-note" style={{ marginTop: 'var(--sp-2)' }}>
              From the {res.reviewCount} most recent reviews of this variant that had something
              to say. The count is how many contain the word — check any of them. Anything you
              add is saved to <strong>this option only</strong>, and the product page shows the
              count beside it.
            </p>
          </>
        );
      }}
    />
  );
}
