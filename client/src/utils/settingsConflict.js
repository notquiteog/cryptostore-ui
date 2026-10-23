import toast from 'react-hot-toast';

/**
 * What to say when a settings save came back a conflict.
 *
 * ── Why this is shared rather than written per page ─────────────────────────
 *
 * Six admin pages write settings, and a 409 from `PUT /api/settings` means one
 * specific thing on all of them: somebody else changed a setting this form was
 * showing, and nothing was written. The useful reply is the same everywhere —
 * name what moved, say nothing landed, and reload so the operator is looking at
 * the truth before they decide what to do.
 *
 * Per-page copies of that would drift, and the direction they drift is
 * predictable: the page that forgets to reload leaves the operator staring at
 * their own stale value with a message saying it is stale, and the obvious next
 * move — press Save again — is the one that must not work.
 *
 * ── Reloading, or choosing ──────────────────────────────────────────────────
 *
 * A caller that passes `onConflict` gets the conflicts and renders
 * `components/admin/SettingsConflict`, which puts both values on screen and
 * asks per key. That is the better outcome and the reason it exists: reloading
 * is correct and throws away work the operator had a reason for, and the reason
 * has not stopped being true because a colleague touched the same switch.
 *
 * A caller that passes only `reload` keeps the older behaviour — say what moved
 * and re-read. That is right for a page whose form is one indivisible document
 * (the home page's promises band, a custom page's prose) where "keep mine for
 * this key" is not a thing anybody can mean.
 *
 * Secrets are named and never shown: the server reports `{ key, secret: true }`
 * for those, and a conflict report that printed somebody's new bot token would
 * be a permission hole with a helpful face on it.
 */
export function reportSettingsError(err, reload, onConflict) {
  const conflicts = err?.data?.conflicts;
  if (err?.data?.code === 'settings_conflict' && Array.isArray(conflicts)) {
    if (typeof onConflict === 'function') {
      // The panel says what happened in full, so a toast as well would be the
      // same sentence twice on one screen.
      onConflict(conflicts);
      return true;
    }
    const names = conflicts.map((c) => c.key).join(', ');
    toast.error(
      `${conflicts.length === 1 ? 'This setting was' : 'These settings were'} changed by somebody `
      + `else while this page was open: ${names}. Nothing was saved — reloading so you can see `
      + 'their values.',
      { duration: 8000 },
    );
    // Reload LAST and unconditionally. The operator's own edits are lost, which
    // is the honest outcome for a page with no per-key choice to offer: they
    // were made against a value that is no longer true, and keeping them on
    // screen invites pressing Save again.
    if (typeof reload === 'function') reload();
    return true;
  }

  // Not a conflict: the page's own message, unchanged.
  const invalid = err?.data?.invalid;
  toast.error(invalid?.[0] ? `${invalid[0].key}: ${invalid[0].error}` : (err?.message || 'Failed to save'));
  return false;
}

export default reportSettingsError;
