import { Plus, Tags } from 'lucide-react';
import DraftTool from './DraftTool';

/**
 * Tag suggestions from the model, under the ones the category already knows.
 *
 * ── Why this sits below the vocabulary row and looks almost the same ───────
 *
 * The product editor already suggests tags: the ones OTHER products in this
 * category carry, with a count (`apedit-suggest`). That row is better evidence
 * than anything a model can offer — a tag eleven products already use is a
 * filter that already works — so it stays first, and this one is the answer to
 * "there is nothing in this category yet" or "none of those fit".
 *
 * The chips are deliberately the same size, shape and dashed border as that
 * row's. Pressing one does exactly the same thing to the field, and giving the
 * two rows different treatments would claim a difference at the point of
 * pressing that does not exist. Only the label above them says where each came
 * from — which is the part an operator actually needs, since one carries
 * evidence and the other carries a guess.
 *
 * ── Why nothing is tracked as "taken" ─────────────────────────────────────
 *
 * A chip leaves the row when the tag lands on the product, and the test for
 * that is the product's real tag list rather than a set of things this
 * component remembers pressing. So a tag typed by hand into the field removes
 * its own chip too, and a draft that survives an undo does not offer a tag the
 * product already has. This mirrors `generate.suggestTags`, which drops
 * already-carried tags server-side for the same reason: a suggestion list
 * whose top half is things you already did is a list people stop reading.
 */
export default function TagAssist({ groupId, existingTags = [], onAdd }) {
  const have = new Set(existingTags.map((t) => String(t).toLowerCase()));
  const fresh = (tags) => (tags || []).filter((t) => !have.has(String(t).toLowerCase()));

  return (
    <DraftTool
      capability="tags"
      icon={Tags}
      label="Suggest tags"
      hint={groupId ? "From this product's own copy, against the tags the shop already uses." : undefined}
      disabled={!groupId}
      disabledHint="Create the product first — there is nothing to read yet."
      className="aidraft-tags"
      run={() => ({ path: `/ai/tags/${groupId}` })}
      renderDraft={(r) => {
        const left = fresh(r.items);
        if (left.length === 0) {
          // Reached either because the model proposed nothing usable or
          // because the operator has since added all of them. Both are a
          // finished job, and saying so beats an empty box.
          return <p className="aidraft-prose">Nothing new to add — this product already carries them.</p>;
        }
        return (
          <div className="aidraft-chips">
            {left.map((tag) => (
              <button
                key={tag}
                type="button"
                className="aidraft-chip"
                onClick={() => onAdd(tag)}
                aria-label={`Add tag ${tag}`}
              >
                <Plus size={10} aria-hidden="true" />
                <span>{tag}</span>
              </button>
            ))}
          </div>
        );
      }}
      actions={[{
        label: 'Add them all',
        icon: Plus,
        onAccept: (r) => fresh(r.items).forEach(onAdd),
      }]}
    />
  );
}
