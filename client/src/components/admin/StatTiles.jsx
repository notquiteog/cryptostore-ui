/**
 * The counter strip an admin queue opens with.
 *
 * Generalised from the Orders page's `.orders-stat-card`, which the customer's
 * own order list also renders — so that family is left where it is and this one
 * carries the shared version rather than three pages each re-deriving the same
 * tile with a different padding.
 *
 * **It is one bar, not a row of equal cards.** It used to be
 * `repeat(auto-fit, minmax(150px, 1fr))` — four separate glass panels, each
 * icon over figure over label, each given exactly the same weight, costing
 * ~130px at the top of five different fulfilment screens before a single row
 * of actual work appeared. Real information is not uniformly weighted, and a
 * layout that treats four counters identically has not asked which of them
 * anyone is here for. The strip is half the height, and the first counter —
 * or whichever the caller marks `lead` — is set larger, because on every one
 * of these queues the first figure is the queue's own depth and the rest are
 * context for it.
 *
 * A tile's colour comes from `--admin-stat-tone`, set per tile. The property is
 * prefixed on purpose: a bare `--tone` or `--accent` would shadow the theme for
 * everything nested inside the tile, and where the intended value *is* a theme
 * token (`var(--accent)`) assigning it to itself is a cyclic reference that
 * resolves to nothing and silently paints no colour at all.
 *
 * `urgent` is for a counter that is not zero *and* means somebody has to do
 * something. It is not "highlight the big number" — a store with 400 delivered
 * orders does not need its delivered tile throbbing.
 */

/**
 * @param {object} props
 * @param {Array<{
 *   key: string, label: string, value: import('react').ReactNode,
 *   icon?: Function, tone?: string, hint?: string, urgent?: boolean,
 *   onClick?: Function, active?: boolean, title?: string, lead?: boolean,
 * }>} props.stats
 */
export default function StatTiles({ stats }) {
  const visible = stats.filter(Boolean);
  if (visible.length === 0) return null;

  // Whichever the caller marked, else the first — every current caller puts
  // the queue's own depth there. Resolved once so two `lead` flags cannot
  // produce two lead cells.
  const leadIdx = Math.max(0, visible.findIndex(s => s.lead));

  return (
    <div className="admin-stats">
      {visible.map((stat, i) => {
        const Icon = stat.icon;
        const className = [
          'admin-stat',
          i === leadIdx ? 'is-lead' : '',
          stat.urgent ? 'is-urgent' : '',
          stat.active ? 'is-active' : '',
          stat.onClick ? 'is-clickable' : '',
        ].filter(Boolean).join(' ');

        // A tile that filters the list is a button; one that only reports is
        // not. Rendering the second as a button would put a stop on every tab
        // through the page for something that does nothing when pressed.
        // Label above the figure, icon inline with the label. The old order —
        // a 28px icon plate, then the figure, then the label — spent a third
        // of each tile's height on the plate and read bottom-up: you saw "8"
        // before you knew what was being counted.
        const content = (
          <>
            <span className="admin-stat-top">
              {Icon && <Icon size={13} className="admin-stat-icon" aria-hidden="true" />}
              <span className="admin-stat-label">{stat.label}</span>
            </span>
            <span className="admin-stat-value">{stat.value}</span>
            {stat.hint && <span className="admin-stat-hint">{stat.hint}</span>}
          </>
        );

        const style = { '--admin-stat-tone': stat.tone || 'var(--primary)', '--i': i };

        return stat.onClick ? (
          <button
            key={stat.key}
            type="button"
            className={className}
            style={style}
            onClick={stat.onClick}
            aria-pressed={!!stat.active}
            title={stat.title}
          >
            {content}
          </button>
        ) : (
          <div key={stat.key} className={className} style={style} title={stat.title}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
