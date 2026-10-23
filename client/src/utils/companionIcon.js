import { framesFor, pathsOf, SIZE } from '../components/ai/sprites';
import { PALETTE } from '../components/ai/BuddySprite';

/**
 * The companion as a PNG, drawn in this browser, for the two places that
 * cannot take an inline SVG: a push notification and the tab icon.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `CLAUDE.md`: nothing may depend on a third party being reachable, and
 * `docs/DESIGN.md` §11: never load an image from a CDN. A push notification
 * has to name an icon by URL, and the service worker's fallback today is
 * `/uploads/logo/logo.png` — a file that does not exist on a store which never
 * uploaded a logo, which is a notification with the browser's generic bell on
 * it. Fetching a hosted placeholder is the one thing this project will not do.
 *
 * So the icon is MADE here: the sprite is already a grid of palette indices,
 * the palette is already resolved by the operator's theme, and a canvas turns
 * the two into a PNG with no request at all. It is the same animal, in the
 * same colours, on a store that has never reached the public internet.
 *
 * ── Why the colours are read rather than passed ─────────────────────────────
 *
 * `BuddySprite` binds each index to a custom property, and the theme system
 * solves those against the operator's background at runtime (theme/
 * computeVars.js). Reading the computed values off the document is therefore
 * the only way to get the colours that are actually on screen — a caller
 * passing colours in would be a second place deciding what the companion looks
 * like, and it would be wrong on every store that changed its palette.
 *
 * ── Why a data URL and not a Blob ───────────────────────────────────────────
 *
 * The service worker has to keep this across restarts, and a blob: URL is
 * scoped to the document that made it. Same class of problem as the proof-of
 * -work worker in utils/pow.js, and the same answer: do not need the scheme.
 */

/** The theme's answer for each palette index, right now. */
function coloursNow() {
  const out = {};
  // Resolve both simple variables and theme-derived shadow mixes through CSS,
  // so exported icons use the exact same palette as the live SVG.
  const probe = document.createElement('span');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  document.documentElement.appendChild(probe);
  try {
    for (const [ch, token] of Object.entries(PALETTE)) {
      probe.style.color = token;
      out[ch] = getComputedStyle(probe).color;
    }
  } finally { probe.remove(); }
  return out;
}

/**
 * One frame as a standalone SVG document.
 *
 * The first frame of the state, never the strip: this is a still, and the
 * animated states are all built so that frame one is a pose the animal can
 * hold — which is the same property `prefers-reduced-motion` depends on.
 */
function svgFor(animal, state) {
  const { frames } = framesFor(animal, state);
  const colours = coloursNow();
  const paths = pathsOf(frames[0])
    .map((layer) => `<path d="${layer.d}" fill="${colours[layer.ch]}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" `
    + `width="${SIZE}" height="${SIZE}" shape-rendering="crispEdges">${paths}</svg>`;
}

/**
 * A PNG data URL of one companion in one state, at `size` square.
 *
 * Resolves to null rather than throwing on any browser that will not do it:
 * every caller's fallback is "leave the icon alone", and a rejected promise
 * three layers down a notification path is a rejection nobody handles.
 */
export function companionPng(animal, { state = 'idle', size = 192 } = {}) {
  return new Promise((resolve) => {
    try {
      const svg = svgFor(animal, state);
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          // Pixel art scaled by an even factor with smoothing ON is a blurred
          // animal, which is the one way this can look worse than no icon.
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0, size, size);
          resolve(canvas.toDataURL('image/png'));
        } catch { resolve(null); }
      };
      img.onerror = () => resolve(null);
      // Encoded rather than raw: an unencoded `#` in a colour ends the data URL
      // at the first fill, and the browser reports a broken image with no clue
      // which character did it.
      img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    } catch { resolve(null); }
  });
}
