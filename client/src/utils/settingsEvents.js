/**
 * "A setting just changed" — said once, by whatever changed it, and heard by
 * whichever page is holding a copy.
 *
 * ── Why an event, and why the Settings page has to hear it ──────────────────
 *
 * The assistant's settings cards carry a button that saves ONE key
 * (components/ai/ResultCard.jsx). The companion panel floats over every admin
 * page, the Settings page included. So an operator could press "Turn it on" on
 * a card with the Settings page open behind it, then change the store name and
 * press Save, and the page would quietly write the OLD value of the switch back
 * over the one they had just changed. The audit log would show both saves; the
 * switch would be off again; nobody would know why.
 *
 * The page used to make that certain, because it PUT back the entire object it
 * had loaded. It no longer does — `utils/settingsDiff` sends only the keys the
 * operator touched, and `__base` makes the server refuse a key that has moved —
 * so the same-tab collision this event was written for is now caught twice over.
 * The event stays because it is the better of the two: refusing a save is a
 * correct outcome and a wasted one, where hearing about the change means the
 * form was never stale in the first place.
 *
 * Same shape as `ORDER_CHANGED` in utils/orderEvents.js: a one-way notice
 * carrying the key and the value the server accepted, fired only after the
 * server said yes.
 */
export const SETTING_CHANGED = 'cs:setting-changed';

/**
 * @param {string} key    the store_settings key that was saved
 * @param {string} value  the value the server accepted
 */
export function announceSettingChanged(key, value) {
  window.dispatchEvent(new CustomEvent(SETTING_CHANGED, { detail: { key, value } }));
}
