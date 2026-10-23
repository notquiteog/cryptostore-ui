import SaveBar from './SaveBar';
import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * The theme page's navigation: one section at a time, behind a tab strip.
 *
 * ── Why tabs here and a rail on the settings page ─────────────────────────
 *
 * They look like the same problem — a long page of cards — and they are not.
 *
 * Settings is a REFERENCE. An operator arrives looking for one control they
 * half-remember, often from the admin search, and the surrounding sections are
 * context that helps them recognise the right one. A rail suits that:
 * everything stays reachable, the page keeps its shape, and a search result
 * can scroll to any control on it.
 *
 * The theme page is a WORKBENCH. Nobody sets a colour and a font and a corner
 * radius in one motion; they work on the palette until it is right, then move
 * to glass, then to type — and between each change they look at the store,
 * which is the whole point of a page that previews live. Thirteen cards
 * stacked vertically meant that loop cost a scroll every time, and a text
 * index down the side of a page about colour is chrome competing with the work.
 *
 * Only the active section is RENDERED, not merely hidden. That matters here
 * beyond tidiness: the effects sections mount WebGL2 previews, and a hidden
 * tab that keeps a fragment shader running is a full-screen field being drawn
 * for nobody.
 *
 * ── The dot ──────────────────────────────────────────────────────────────
 *
 * What tabs cost is visibility: a change made on Palette becomes invisible the
 * moment you switch to Type, and the save bar's total count cannot say where
 * it was. So a tab carrying unsaved changes wears a dot. Without it, tabs
 * would trade a scroll for a worse problem — "something is unsaved and I
 * cannot find it".
 */
export default function ThemeTabs({
  sections,        // [{ id, label }] in order
  active,
  onSelect,
  changedByTab,    // { [id]: number }
  dirtyCount,
  saving,
  blocked,
  saveNote,
  onSave,
  onDiscard,
  children,        // the active section's content
}) {
  const strip = useRef(null);
  const [edges, setEdges] = useState({ before: false, after: false });
  useEffect(() => {
    const el = strip.current;
    const measure = () => setEdges({ before: el.scrollLeft > 2, after: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const observer = new ResizeObserver(() => {
      el.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      measure();
    });
    observer.observe(el);
    el.addEventListener('scroll', measure, { passive: true });
    measure();
    return () => { observer.disconnect(); el.removeEventListener('scroll', measure); };
  }, []);
  useEffect(() => {
    strip.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  const navigate = (event, index) => {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    const next = key === 'Home' ? 0 : key === 'End' ? sections.length - 1
      : (index + (key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
    onSelect(sections[next].id);
    strip.current.querySelectorAll('[role="tab"]')[next].focus();
  };
  return (
    <div className="thm">
      <div className="thm-tab-navigation">
        <button type="button" className="thm-scroll" aria-label="Scroll theme sections left" disabled={!edges.before} onClick={() => strip.current.scrollBy({ left: -240 })}><ChevronLeft size={16} /></button>
      <div ref={strip} className="thm-tabs" role="tablist" aria-label="Theme sections">
        {sections.map((s, index) => {
          const changed = changedByTab[s.id] || 0;
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              id={`thm-tab-${s.id}`}
              aria-selected={active === s.id}
              aria-controls={`thm-panel-${s.id}`}
              tabIndex={active === s.id ? 0 : -1}
              onKeyDown={(event) => navigate(event, index)}
              className={`thm-tab${active === s.id ? ' is-on' : ''}`}
              onClick={() => onSelect(s.id)}
            >
              {s.label}
              {changed > 0 && (
                <span
                  className="thm-tab-dot"
                  title={`${changed} unsaved ${changed === 1 ? 'change' : 'changes'} here`}
                  aria-label={`${changed} unsaved ${changed === 1 ? 'change' : 'changes'}`}
                />
              )}
            </button>
          );
        })}
      </div>
        <button type="button" className="thm-scroll" aria-label="Scroll theme sections right" disabled={!edges.after} onClick={() => strip.current.scrollBy({ left: 240 })}><ChevronRight size={16} /></button>
      </div>

      <div
        className="thm-panel"
        role="tabpanel"
        id={`thm-panel-${active}`}
        aria-labelledby={`thm-tab-${active}`}
        tabIndex={0}
        /* Keyed on the active tab so switching re-runs the entrance
           transition rather than swapping content under a static frame — the
           same reasoning the two-factor card's panel uses. */
        key={active}
      >
        {children}
      </div>

      <SaveBar
        dirtyCount={dirtyCount}
        saving={saving}
        blocked={blocked}
        note={saveNote}
        onSave={onSave}
        onDiscard={onDiscard}
        cleanNote="No unsaved changes. Previewing a mode does not change the store default."
      />
    </div>
  );
}
