/**
 * Which tab of the theme editor owns each editable key.
 *
 * A plain module rather than part of Theme.jsx, for the same reason
 * components/effects/glsl.js is one: node cannot import `.jsx`, so this could
 * not be checked without a browser while it lived beside the component — and
 * it is exactly the kind of mapping that rots silently. A key that falls
 * through to the wrong tab puts its unsaved-changes dot on a section that does
 * not contain it, which is worse than no dot at all.
 */

import { PALETTE_ROLES, SCALAR_BY_KEY, FONT_KEYS } from './defaults.js';

/**
 * The tabs, in order. `id` matches each card's `data-theme-section`.
 *
 * Presets leads rather than Colour mode: applying a preset is both the most
 * common thing done on this page and the one that changes the most at once, so
 * it is what the page should open on.
 */
export const THEME_TABS = [
  { id: 'mode', label: 'Colour mode' },
  { id: 'presets', label: 'Presets' },
  { id: 'palette', label: 'Brand & page' },
  { id: 'status', label: 'Status' },
  { id: 'glow', label: 'Glow' },
  { id: 'glass', label: 'Glass' },
  { id: 'shape', label: 'Shape' },
  { id: 'type', label: 'Type' },
  { id: 'navbar', label: 'Navigation bar' },
  { id: 'mobile', label: 'Mobile & PWA' },
  { id: 'bg-effects', label: 'Background effects' },
  { id: 'header-effects', label: 'Header effects' },
  { id: 'preview', label: 'Preview' },
];

/**
 * Which tab owns each editable key.
 *
 * Only exists because tabs hide things. The save bar can say "3 unsaved
 * changes"; without this it could not say WHERE, and an operator who applied a
 * preset and then wandered to Type would have three changes they cannot find.
 * Derived from the same `group` field the editor already renders the palette
 * and scalar fields from, so a role moved between groups moves its dot with it
 * rather than needing a second edit here.
 */
export const tabForKey = (key) => {
  const base = key.endsWith('_light') ? key.slice(0, -6) : key;

  if (key === 'theme_mode' || key === 'theme_allow_visitor_mode') return 'mode';
  if (key === 'theme_presets') return 'presets';
  if (FONT_KEYS.includes(key)) return 'type';
  if (key.startsWith('pwa_')) return 'mobile';
  if (key.startsWith('navbar_') || base === 'theme_logo_color') return 'navbar';
  if (key.startsWith('effects_header') || base === 'theme_header_color'
    || base === 'theme_header_shader_color' || base === 'theme_header_shader_color_2') return 'header-effects';
  if (key.startsWith('effects_') || base === 'theme_sparkle_color' || base === 'theme_smoke_color'
    || base === 'theme_snow_color' || base === 'theme_aurora_color'
    || base === 'theme_shader_color' || base === 'theme_shader_color_2') return 'bg-effects';

  const role = PALETTE_ROLES.find((r) => r.key === base);
  if (role) return role.group === 'ground' ? 'palette' : (role.group === 'brand' ? 'palette' : role.group);

  const scalar = SCALAR_BY_KEY[key];
  if (scalar) return scalar.group;

  // Anything unclassified lands on the palette tab rather than nowhere: an
  // unreachable dot is worse than one in a slightly odd place, because the
  // count in the bar would then disagree with the sum of the dots.
  return 'palette';
};
