/**
 * Who owns the tab icon.
 *
 * Two things want to write `#dynamic-favicon` and they want it for different
 * lengths of time. The theme paints the store's own mark and expects it to
 * stay (context/ThemeContext.jsx); the admin's status light wants to replace
 * it for as long as a background job is running or stalled, and then give it
 * back exactly as it was.
 *
 * Two writers and one element is how a tab ends up wearing a companion on a
 * storefront somebody re-themed halfway through an index pass — whichever
 * wrote last wins, and neither knows the other exists. So neither of them
 * writes the element. They declare a BASE and an OVERRIDE here, and this file
 * is the only thing that touches the DOM: the override wins while it is set,
 * the base comes back the moment it is cleared, and a theme change during an
 * override updates what will be restored rather than fighting over the tab.
 */

let base = null;
let baseType = null;
let override = null;

function paint() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById('dynamic-favicon');
  if (!el) return;
  const href = override || base;
  if (!href) return;
  el.href = href;
  el.type = override ? 'image/png' : (baseType || 'image/png');
}

/** The store's own mark. Called by the theme; restored when an override ends. */
export function setFaviconBase(href, type = 'image/png') {
  base = href;
  baseType = type;
  paint();
}

/**
 * Borrow the tab for something that matters right now, or `null` to give it
 * back. Deliberately last-writer-wins with a single slot: if two surfaces ever
 * want the tab at once, the honest fix is deciding which one matters, not
 * stacking them and showing whichever happened to be pushed last.
 */
export function setFaviconOverride(href) {
  override = href || null;
  paint();
}

/** What the tab is showing, for anything that needs to know. */
export function faviconOverridden() {
  return Boolean(override);
}
