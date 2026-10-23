import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import SaveBar from './SaveBar';

/**
 * The frame the settings page lives in: a section rail, the content column,
 * and a save bar that only exists while there is something to save.
 *
 * ── What it replaced ──────────────────────────────────────────────────────
 *
 * An 860px centred column of a dozen identical `.glass-card`s, stacked in the
 * order they were written, with one "Save all" button at the very top. DESIGN
 * §1's "centred column" and "one elevation for everything" together, on the
 * longest page in the admin panel — but the two failures that actually cost
 * the operator something were subtler:
 *
 *   - **The save button was two thousand pixels above the field being
 *     edited.** Changing the packing claim meant scrolling back to the top to
 *     commit it, and the page gave no hint it needed committing at all.
 *   - **Nothing said what had changed.** `handleSave` PUTs the entire settings
 *     object, so a page left open across a distraction would post whatever was
 *     in it, and an operator who could not remember what they had touched had
 *     no way to find out short of reloading and losing the lot.
 *
 * The save bar answers both. It appears only when the working copy differs
 * from what was loaded, names the count, and offers to discard — which is the
 * first time this page has had an undo of any kind.
 *
 * ── The rail ──────────────────────────────────────────────────────────────
 *
 * A jump list, marking whichever section is on screen. The page is long enough
 * that scrolling is the primary cost of using it, and DESIGN §9 asks a screen
 * to say where it is; a settings page with fourteen sections and no map is a
 * page you navigate with the browser's find.
 *
 * `IntersectionObserver` rather than a scroll handler: a scroll listener on a
 * page this tall fires hundreds of times a second and has to measure every
 * section on each one, which is exactly the kind of jank that makes a
 * long form feel broken on a phone.
 *
 * ── Chapters ──────────────────────────────────────────────────────────────
 *
 * The rail takes its sections in chapters — eight labelled groups of three or
 * four — because twenty-seven names in one column is a list to be read, not a
 * map to be glanced at (config/settingsChapters.js says why, and which card
 * goes where). A chapter label is a coarse jump: pressing it goes to the
 * chapter's first card. Only cards are observed and only cards are ever
 * "current"; a label that could also be current would fight the card under
 * it. A page with no chapters still passes a flat `sections` list.
 */
export default function SettingsShell({
  chapters,        // [{ id, label, sections: [{ id, label, icon }] }] in page order
  sections,        // the flat form, for a page with no chapters
  dirtyCount,
  saving,
  onSave,
  onDiscard,
  children,
  /*
   * Which attribute marks a section.
   *
   * `data-settings-section` is not just a hook for this rail — the admin nav's
   * search resolves a result by querying for it, so the Theme page marking its
   * cards with the same attribute would put twenty new answers in front of a
   * resolver that expects the settings page's. The Theme page passes
   * `data-theme-section` and the two stay out of each other's way.
   */
  sectionAttr = 'data-settings-section',
  /** Copy for the clean state; the two pages save different things. */
  cleanNote = 'Everything here matches what is stored.',
}) {
  /*
   * One flat list for the observer, whichever shape the page passed. Memoised
   * on the props' identity: the observer effect keys on it, and a fresh array
   * every render would tear down and re-observe every section on each render.
   */
  const chapterList = useMemo(
    () => chapters || [{ id: 'all', label: null, sections: sections || [] }],
    [chapters, sections],
  );
  const flat = useMemo(() => chapterList.flatMap((c) => c.sections), [chapterList]);
  const [active, setActive] = useState(flat[0]?.id || null);
  const contentRef = useRef(null);

  useEffect(() => {
    const nodes = flat
      .map((s) => document.querySelector(`[${sectionAttr}="${s.id}"]`))
      .filter(Boolean);
    if (nodes.length === 0) return undefined;

    /*
     * `rootMargin` pulls the trigger line up to a third from the top rather
     * than using the viewport edge. Without it the "current" section is
     * whichever one is scraping the bottom of the screen, which is never the
     * one being read — the rail highlight lagged a whole section behind the
     * content and looked broken.
     */
    /*
     * The visible state of EVERY observed section, not just the ones that
     * changed.
     *
     * The callback is handed only the entries whose intersection CHANGED, and
     * reading the answer off that batch alone is wrong in a way that looks
     * like an off-by-one: jumping to a short section highlighted the section
     * after it, because the one that had just scrolled into the band was in
     * the batch and the one already sitting in it was not. Keeping the last
     * known state per node and choosing across the whole map makes the answer
     * describe the page rather than the last scroll delta.
     */
    const visible = new Set();

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target);
          else visible.delete(e.target);
        }
        /*
         * Positions are read LIVE here rather than taken from
         * `entry.boundingClientRect`, and that is not a detail.
         *
         * The rectangle on an entry is where the element was when that entry
         * fired, so for a section that entered the band a second ago it is
         * already stale by however far the page has scrolled since. Comparing
         * a fresh rectangle against a stale one picked whichever section had
         * moved most recently instead of whichever is highest — the highlight
         * skipped ahead by one on any scroll that crossed two sections.
         *
         * It costs one `getBoundingClientRect` per section still in the band —
         * usually one or two, never all eighteen — and only when the observer
         * fires, which is on crossings rather than on every scroll frame.
         */
        let bestId = null;
        let bestTop = Infinity;
        for (const node of visible) {
          const top = node.getBoundingClientRect().top;
          if (top >= bestTop) continue;
          bestTop = top;
          bestId = node.getAttribute(sectionAttr);
        }
        if (bestId) setActive(bestId);
      },
      { rootMargin: '-10% 0px -70% 0px', threshold: 0 },
    );
    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [flat, sectionAttr]);

  const jump = useCallback((id) => {
    const el = document.querySelector(`[${sectionAttr}="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // Set immediately rather than waiting for the observer: a smooth scroll
    // takes long enough that the rail would sit on the old entry for most of
    // the journey, which reads as the click not having registered.
    setActive(id);
  }, [sectionAttr]);

  return (
    <div className="aset">
      <div className="aset-cols">
        {/* ── Rail ─────────────────────────────────────────────────────── */}
        <nav className="aset-rail" aria-label="Settings sections">
          <ul>
            {chapterList.map((chapter) => (
              <li key={chapter.id} className="aset-rail-chapter">
                {chapter.label && (
                  <button
                    type="button"
                    className="aset-rail-chapter-label"
                    onClick={() => chapter.sections[0] && jump(chapter.sections[0].id)}
                  >
                    {chapter.label}
                  </button>
                )}
                <ul>
                  {chapter.sections.map((s) => {
                    const Icon = s.icon;
                    return (
                      <li key={s.id}>
                        <button
                          type="button"
                          className={`aset-rail-link${active === s.id ? ' is-on' : ''}`}
                          aria-current={active === s.id ? 'true' : undefined}
                          onClick={() => jump(s.id)}
                        >
                          {Icon && <Icon size={14} aria-hidden="true" />}
                          <span>{s.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </nav>

        <div className="aset-main" ref={contentRef}>{children}</div>
      </div>

      <SaveBar
        dirtyCount={dirtyCount}
        saving={saving}
        onSave={onSave}
        onDiscard={onDiscard}
        cleanNote={cleanNote}
      />
    </div>
  );
}
