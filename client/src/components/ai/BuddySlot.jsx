import { lazy, Suspense } from 'react';
import { useAiCapability } from '../../hooks/useAiTool';

const Buddy = lazy(() => import('./Buddy'));

/**
 * The companion's place in the navbar, without the companion in the bundle.
 *
 * ── What this saves, and who it saves it for ────────────────────────────────
 *
 * `Buddy` is the assistant panel, the sprite, the sprite's animation tables and
 * the roaming behaviour — roughly 150 KB of source, statically imported by
 * `Navbar`, which is in the shopper's entry chunk. `ai_enabled` is FALSE on a
 * new install and stays false on every store that does not run a model, so the
 * overwhelmingly common case was every visitor downloading the whole companion
 * before the page could paint, for a feature the shop does not have.
 *
 * `CLAUDE.md` is what makes that worth a component rather than a shrug: the
 * store has to work for a buyer on a filtered network the operator does not
 * control, and the cheapest byte is the one not sent.
 *
 * ── Why the gate is here and also still inside `Buddy` ──────────────────────
 *
 * `Buddy` keeps its own `if (!offered) return null`, and that is not
 * redundancy to tidy away. It reads the FULL status — the capability's
 * `offered` flag as the server computed it for this viewer — while this reads
 * only whether the assistant capability exists at all, which is the cheapest
 * question that can decide not to fetch 150 KB. The two answers agree in every
 * case that matters; when they disagree, the heavy chunk loads and then renders
 * nothing, which is exactly what it did before this file existed.
 *
 * `offered !== true` rather than `!offered`, for the reason `useAiCapability`
 * documents: `undefined` means the status has not landed, and treating that as
 * "no" would put a companion into the navbar a moment after the page settles.
 *
 * `fallback={null}` because there is nothing to say while it loads. A spinner
 * where a mascot will be is a worse first paint than no mascot.
 */
export default function BuddySlot(props) {
  const offered = useAiCapability('assistant');
  if (offered !== true) return null;
  return (
    <Suspense fallback={null}>
      <Buddy {...props} />
    </Suspense>
  );
}
