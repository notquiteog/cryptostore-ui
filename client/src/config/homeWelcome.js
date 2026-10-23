import { STORE_LINK_IDS, resolveStoreLink } from './storeLinks.js';

// The server enforces the same caps in config/welcomeKeys.js; the contract
// test keeps this editor registry in step with the public settings allowlist.
export const WELCOME_TEXT_FIELDS = [
  { key: 'home_welcome_eyebrow', label: 'Intro label', max: 80, hint: 'The small label above the headline. Clear to hide it.' },
  { key: 'home_welcome_heading', label: 'Welcome heading', max: 100, default: 'Discover something', hint: 'Blank uses “Discover something”.' },
  { key: 'home_welcome_highlight', label: 'Highlighted heading', max: 100, default: 'worth finding.', hint: 'The second line, in your theme’s primary color. Clear to hide it.' },
  { key: 'home_welcome_description', label: 'Welcome description', max: 400, multiline: true, hint: 'The supporting text below the headline. Clear to hide it.' },
  { key: 'home_welcome_primary_label', label: 'Primary button text', max: 48, default: 'Explore the catalog', hint: 'Blank uses “Explore the catalog”.' },
  { key: 'home_welcome_secondary_label', label: 'Secondary button text', max: 48, default: 'Featured picks', hint: 'Blank uses “Featured picks”.' },
  { key: 'home_welcome_spotlight_label', label: 'Spotlight label', max: 48, default: 'In the spotlight', hint: 'The badge over the featured product. Clear to hide it.' },
];
export const WELCOME_DEFAULTS = {
  home_welcome_enabled: 'true',
  ...Object.fromEntries(WELCOME_TEXT_FIELDS.map(field => [field.key, field.default ?? ''])),
  home_welcome_primary_link: 'products',
  home_welcome_secondary_link: 'featured',
  home_welcome_show_spotlight: 'true',
  home_welcome_show_categories: 'true',
  home_welcome_spotlight_product: 'auto',
};
export const WELCOME_KEYS = Object.keys(WELCOME_DEFAULTS);

export function welcomeFormValues(settings = {}) {
  const defaults = { ...WELCOME_DEFAULTS,
    home_welcome_eyebrow: settings.store_name || 'CryptoStore',
    home_welcome_description: settings.store_tagline || 'Explore the collection and find your next favorite.',
  };
  return Object.fromEntries(WELCOME_KEYS.map(key => [key, settings[key] ?? defaults[key]]));
}

export function readWelcomeSettings(settings = {}) {
  const values = welcomeFormValues(settings);
  for (const field of WELCOME_TEXT_FIELDS) {
    const raw = values[field.key];
    values[field.key] = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, field.max) : (field.default || '');
  }
  for (const key of ['home_welcome_heading', 'home_welcome_primary_label', 'home_welcome_secondary_label']) {
    values[key] ||= WELCOME_DEFAULTS[key];
  }
  return values;
}

export function welcomeDestination(id, { settings, user, hasProducts }) {
  if (id === 'featured') return hasProducts ? { href: '#featured-products' } : null;
  return STORE_LINK_IDS.includes(id) ? resolveStoreLink(id, { settings, user }) : null;
}
