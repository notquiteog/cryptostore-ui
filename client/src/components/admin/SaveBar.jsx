import { Save, Undo2, Check, AlertTriangle } from 'lucide-react';

/**
 * The unsaved-changes bar, shared by the settings page, the theme page and the
 * rate-limits page.
 *
 * Extracted when the theme page moved from a section rail to tabs: the two
 * pages navigate completely differently now, but they commit identically —
 * a working copy, a count of what differs, save, discard. Leaving a copy in
 * each shell would have been two places for the next change to the save
 * language to land, and only one of them would get it.
 *
 * The rate-limits page joined afterwards, and it is the reason for the three
 * optional props below. It had grown its own bar because it commits under two
 * conditions the first version did not model, and a third copy of the save
 * language is exactly what this file exists to prevent:
 *
 * - `blocked` — the save cannot go out yet for a reason that is not "already
 *   saving". Limits has seventy-two numeric fields with a registry min and max
 *   apiece, and a value outside its range is a request the server will reject;
 *   the bar has to refuse rather than let the operator find out from a toast.
 * - `note` — one line under the count saying what that reason is, or what
 *   saving will do. Callers that have nothing to add pass nothing and the bar
 *   is exactly the single line it always was.
 * - `extra` — a control rendered before Discard. Limits puts a "Review" button
 *   there that filters the list down to the pending records: with thirty-six
 *   of them, "3 unsaved changes" is a number you want to be able to open.
 *
 * It is rendered only while dirty. A permanently docked bar eating 60px of a
 * long form to say "nothing to do" is the kind of chrome DESIGN §7 asks every
 * control to justify — and the clean line that replaces it is not decoration
 * either: a page that saves silently is one you reload to check. A caller that
 * says the clean state elsewhere (Limits puts it in the page subtitle, where a
 * count of what is enforcing has to be anyway) passes no `cleanNote` and gets
 * nothing rather than a second, quieter copy of the same fact.
 */
export default function SaveBar({
  dirtyCount,
  saving,
  onSave,
  onDiscard,
  cleanNote,
  blocked = false,
  note,
  extra,
}) {
  if (dirtyCount > 0) {
    return (
      <div className="aset-savebar" role="region" aria-label="Unsaved changes">
        <div className="aset-savebar-text">
          {/* `aria-live` so the count reaching a screen reader does not depend on
              having noticed a bar appear at the bottom of the viewport. It is on
              the count and not the whole bar: the count changes when a field
              first differs from its stored value, which is an event worth
              announcing, while the buttons beside it never change at all. */}
          <span className="aset-savebar-count" aria-live="polite">
            <AlertTriangle size={14} aria-hidden="true" />
            {dirtyCount} unsaved {dirtyCount === 1 ? 'change' : 'changes'}
          </span>
          {note ? <span className="aset-savebar-note">{note}</span> : null}
        </div>
        <span className="aset-savebar-actions">
          {extra}
          <button type="button" className="glass-btn glass-btn-sm" onClick={onDiscard} disabled={saving}>
            <Undo2 size={13} aria-hidden="true" /> Discard
          </button>
          <button
            type="button"
            className="glass-btn glass-btn-sm glass-btn-primary"
            onClick={onSave}
            disabled={saving || blocked}
          >
            {saving ? <span className="spinner spinner-inline" /> : <Save size={13} aria-hidden="true" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </span>
      </div>
    );
  }

  if (saving || !cleanNote) return null;

  return (
    <p className="aset-clean" aria-live="polite">
      <Check size={13} aria-hidden="true" /> {cleanNote}
    </p>
  );
}
