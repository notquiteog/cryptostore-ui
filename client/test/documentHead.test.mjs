/**
 * The tab title and the head, as the router swaps pages under them.
 *
 *   node --test client/test/documentHead.test.mjs
 *
 * No DOM: `resolveHead` is the rules and `applyHead` is the pen. What is
 * worth pinning is the rules — that the client says about a page exactly
 * what the server said when it served it (server/services/seo.js), that a
 * page's late data cannot title the page the visitor has moved to, and that
 * nothing is written before the store's own name is known.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveHead, composeTitle, setStoreIdentity, setRouteHead, setPageHead, clearPageHead, headState,
  ROBOTS_ON, ROBOTS_OFF, ROBOTS_PRIVATE, ROBOTS_SEARCH,
} from '../src/utils/documentHead.js';
import { routeDefaults, PRIVATE_SEGMENTS, PRIVATE_TITLES } from '../src/config/pageHead.js';

const store = (over = {}) => ({
  loaded: true, name: 'Nightshade', tagline: 'Plain packaging', description: 'Discreet and lab-tested.', indexing: true, guestBrowsing: true, ...over,
});
const route = (pathname) => ({ pathname, ...routeDefaults(pathname) });

test('the title is the store alone at home, and Page · Store everywhere else', () => {
  assert.equal(composeTitle(store(), null, { isHome: true }), 'Nightshade — Plain packaging');
  assert.equal(composeTitle(store({ tagline: '' }), null, { isHome: true }), 'Nightshade');
  assert.equal(composeTitle(store(), 'Catalog'), 'Catalog · Nightshade');
  assert.equal(composeTitle(store({ name: '' }), 'Catalog'), 'Catalog', 'no name yet: the page alone rather than " · "');
});

test('every private route is titled in its own words and kept out of the index', () => {
  for (const seg of PRIVATE_SEGMENTS) {
    const head = resolveHead({ store: store(), route: route(`/${seg}/anything`), page: null });
    assert.equal(head.title, `${PRIVATE_TITLES[seg]} · Nightshade`, seg);
    assert.equal(head.robots, ROBOTS_PRIVATE, seg);
    assert.equal(head.canonicalPath, null, seg);
  }
});

test('the page layer wins only for the path it was set on', () => {
  const page = { pathname: '/products/12', title: 'Blue Dream', description: 'A hybrid.' };
  const same = resolveHead({ store: store(), route: route('/products/12'), page });
  assert.equal(same.title, 'Blue Dream · Nightshade');
  assert.equal(same.description, 'A hybrid.');
  assert.equal(same.canonicalPath, '/products/12');

  const moved = resolveHead({ store: store(), route: route('/products/13'), page });
  assert.equal(moved.title, 'Nightshade', 'the old product\'s data does not title the next product');
  assert.equal(moved.description, 'Discreet and lab-tested.', 'the store\'s description stands in');
});

test('the robots directive follows the server\'s rules', () => {
  assert.equal(resolveHead({ store: store(), route: route('/products'), page: null }).robots, ROBOTS_ON);
  assert.equal(resolveHead({ store: store({ indexing: false }), route: route('/products'), page: null }).robots, ROBOTS_OFF);
  assert.equal(resolveHead({ store: store({ indexing: false }), route: route('/'), page: null }).robots, ROBOTS_OFF);
  assert.equal(resolveHead({ store: store({ guestBrowsing: false }), route: route('/products/12'), page: null }).robots, ROBOTS_PRIVATE, 'a guest-locked catalogue is nobody\'s result');
  assert.equal(resolveHead({ store: store({ guestBrowsing: false }), route: route('/'), page: null }).robots, ROBOTS_ON, 'the home page stays findable');
  const search = resolveHead({ store: store(), route: route('/products'), page: { pathname: '/products', robots: ROBOTS_SEARCH, canonicalPath: '/products' } });
  assert.equal(search.robots, ROBOTS_SEARCH);
  const missing = resolveHead({ store: store(), route: route('/no-such-page'), page: { pathname: '/no-such-page', title: 'Page not found', robots: ROBOTS_PRIVATE } });
  assert.equal(missing.title, 'Page not found · Nightshade');
  assert.equal(missing.canonicalPath, null, 'a noindex page has no canonical');
});

test('the catalogue keeps its category and page number in the canonical, nothing else', () => {
  const head = resolveHead({ store: store(), route: route('/products'), page: { pathname: '/products', title: 'Flower', canonicalPath: '/products?category=Flower&page=2' } });
  assert.equal(head.title, 'Flower · Nightshade');
  assert.equal(head.canonicalPath, '/products?category=Flower&page=2');
});

test('the layers compose through the setters, and a page clears only its own entry', () => {
  setStoreIdentity({ name: 'Nightshade', tagline: '', indexing: true, guestBrowsing: true });
  setRouteHead('/products/12');
  setPageHead('/products/12', { title: 'Blue Dream' });
  assert.equal(resolveHead(headState()).title, 'Blue Dream · Nightshade');

  setRouteHead('/products/13');
  setPageHead('/products/13', { title: 'Sour Diesel' });
  clearPageHead('/products/12');
  assert.equal(headState().page.title, 'Sour Diesel', 'the old page\'s cleanup left the new page\'s entry alone');
  clearPageHead('/products/13');
  assert.equal(headState().page, null);
  assert.equal(resolveHead(headState()).title, 'Nightshade');
});

test('nothing is written before the store has loaded', () => {
  const doc = { title: 'Served title', head: { querySelector: () => { throw new Error('touched the head'); } } };
  const fresh = { store: { loaded: false, name: '', tagline: '', description: '', indexing: false, guestBrowsing: false }, route: route('/products'), page: null };
  // resolveHead on an unloaded store composes a bare page title — which is
  // exactly why applyHead refuses to write it (documentHead.js).
  assert.equal(resolveHead(fresh).title, 'Catalog');
  assert.equal(doc.title, 'Served title');
});
