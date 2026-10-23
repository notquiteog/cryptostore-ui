/**
 * Keep the browser's form-filler out of the admin panel.
 *
 * The panel is full of fields a credential manager reads as a sign-in form: an
 * RPC password on Nodes, a wallet passphrase beside it, a carrier API secret on
 * the tracking settings, a key passphrase on PGP, half a dozen `type="password"`
 * secrets on Settings. Chrome sees a password input with a text input near it,
 * classifies the page as a login, and offers — or on a revisit silently injects
 * — the operator's saved store credentials. What the operator then saves to the
 * store is their own account password sitting in `bitcoin_rpc_pass`, and the
 * only symptom is a node that will not connect.
 *
 * `autocomplete="off"` does not fix it, which is the part that keeps being
 * re-learned here: browsers deliberately ignore `off` on credential fields,
 * because sites used it to fight password managers. Nodes, PGP and the tracking
 * settings all declared `off` on their password inputs and were filled anyway.
 * The token browsers do honour on a password field is `new-password` — it says
 * "this is a value being set, not a login", so saved credentials are not
 * offered. On every other field `off` is respected and is the right answer.
 *
 * The attribute alone still leaves the third-party managers, which run their own
 * heuristics over the DOM and ignore `autocomplete` entirely. Each publishes an
 * opt-out attribute; they cost nothing and are listed in MANAGER_OPT_OUTS.
 *
 * This runs as a DOM pass rather than as an attribute on each field on purpose.
 * Fifty-three files under pages/admin and components/admin render inputs, there
 * is no shared input component to put it in, and the failure is silent: the
 * fifty-fourth file to add a password field would be filled and nobody would
 * know until a wrong secret reached the database. A pass over the admin shell
 * cannot be forgotten by a page that has not been written yet.
 *
 * What it deliberately does not touch:
 *
 *   - Anything outside the admin shell. /login and /register want the manager
 *     to fill them, and checkout wants real address autofill — that is the
 *     buyer's own convenience, and the storefront is not what gets injected.
 *   - A field that declares a fill token itself. `one-time-code` on a TOTP box
 *     means the component asked for that behaviour; only the values a browser
 *     ignores (`off`, `on`, empty) are replaced, and only on password fields
 *     where they are the ones that do not work.
 *   - `<datalist>` suggestions, which is what the admin search, the actor
 *     filter on the audit log and the carrier boxes on the ship desk use.
 *     `autocomplete="off"` governs the browser's own autofill; a field's own
 *     `list=` options keep working, and that in-app autocomplete is the part
 *     nobody wanted turned off.
 */

/** Everything the filler will touch, plus the forms it classifies them by. */
const FILLABLE_SELECTOR = 'input, select, textarea, form';

/** Input types the filler has nothing to say about. */
const NOT_FILLABLE = new Set([
  'hidden', 'checkbox', 'radio', 'button', 'submit', 'reset',
  'image', 'file', 'range', 'color',
]);

/**
 * Values a browser treats as "no opinion" rather than as an instruction. A
 * password field carrying one of these is filled exactly as if the attribute
 * were absent, so these are the ones this pass is allowed to overwrite.
 */
const INERT_TOKENS = new Set(['', 'off', 'on']);

/**
 * The password managers' own opt-outs. Each of these is that vendor's
 * documented way to say "not a credential field"; none of them read
 * `autocomplete`. An unknown attribute is inert everywhere else.
 */
const MANAGER_OPT_OUTS = [
  ['data-1p-ignore', ''],      // 1Password
  ['data-lpignore', 'true'],   // LastPass
  ['data-bwignore', 'true'],   // Bitwarden
  ['data-form-type', 'other'], // Dashlane
];

function tagOf(el) {
  return String(el.tagName || '').toLowerCase();
}

/** The token this element should carry, given what the browser acts on. */
function tokenFor(tag, type) {
  // `new-password` rather than `off`: see the header. `off` on a password input
  // is ignored by every major browser and was why these fields were being
  // filled while appearing to opt out.
  return tag === 'input' && type === 'password' ? 'new-password' : 'off';
}

/**
 * Stamp one element. Returns true if it was changed, which is what the tests
 * assert on; callers have no use for it.
 */
export function stampField(el) {
  const tag = tagOf(el);
  if (tag !== 'input' && tag !== 'select' && tag !== 'textarea' && tag !== 'form') return false;

  const type = tag === 'input'
    ? String(el.getAttribute('type') || 'text').toLowerCase()
    : '';
  if (NOT_FILLABLE.has(type)) return false;

  const want = tokenFor(tag, type);
  const declared = el.getAttribute('autocomplete');

  // The component named a real token — `one-time-code`, `current-password` on a
  // field that genuinely is one. It meant it; leave the element entirely alone,
  // opt-out attributes included, or this pass would quietly break the one case
  // where filling was asked for.
  if (declared !== null && !INERT_TOKENS.has(declared) && declared !== want) return false;

  let changed = false;
  if (declared !== want) {
    el.setAttribute('autocomplete', want);
    changed = true;
  }
  if (tag !== 'form') {
    for (const [name, value] of MANAGER_OPT_OUTS) {
      if (el.getAttribute(name) !== value) {
        el.setAttribute(name, value);
        changed = true;
      }
    }
  }
  return changed;
}

/** Stamp `root` itself if it is a field, then everything under it. */
export function applyNoAutofill(root) {
  if (!root) return;
  if (typeof root.matches === 'function' && root.matches(FILLABLE_SELECTOR)) stampField(root);
  if (typeof root.querySelectorAll !== 'function') return;
  for (const el of root.querySelectorAll(FILLABLE_SELECTOR)) stampField(el);
}

/**
 * Stamp `root` now and keep stamping what React mounts into it.
 *
 * Watching `document.body` rather than the admin `<main>` is deliberate: the
 * staff notice tray, the assistant panel and the onboarding tour render through
 * `createPortal` into the body, so a subtree observer rooted at the layout would
 * miss precisely the surfaces that float over it.
 *
 * `type` is in the attribute filter because a "show passphrase" toggle flips a
 * field between `password` and `text`, and the field coming back to `password`
 * has to be re-stamped. Nothing else is observed, so the theme editor writing
 * custom properties to `:root` on every slider drag does not wake this up.
 *
 * Returns the teardown, so a caller can `useEffect(() => watchNoAutofill(...))`.
 */
export function watchNoAutofill(root) {
  if (!root || typeof MutationObserver === 'undefined') return () => {};
  applyNoAutofill(root);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        stampField(record.target);
        continue;
      }
      for (const node of record.addedNodes) {
        if (node.nodeType === 1) applyNoAutofill(node);
      }
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['type'],
  });
  return () => observer.disconnect();
}
