/**
 * Theme-aware pixel companions. Artwork lives in spriteArt.js; this file owns
 * their temperament, reusable grid transforms and cached animation sequences.
 * Held poses share array identity, so BuddySprite draws each only once.
 */
import { ART, BASES } from './spriteArt.js';
import { TRAVEL_ART } from './spriteMotion.js';

const SIZE = 32;
const BLANK = '.'.repeat(SIZE);

/** Four authored poses provide opposite foot contacts and a species-specific
 * gesture. Breath, gaze and anticipation compose over them without a ticker.
 * Habits are intentionally different: a penguin never grooms like a cat, and a
 * slime flows through its contact poses instead of borrowing a walking gait.
 */
const ANIMALS = {
  owl: {
    label: 'Owl', note: 'A watchful little sentinel. Scans the room, blinks slowly and fans its feathered wings to greet you.',
    tempo: 1.35, belly: 23, head: 19, airborne: true, speed: 0.9,
    habits: ['look', 'groom', 'flutter'],
    idle: 'rest*20 rest.lid rest.blink rest.lid rest*12 rest.left*5 rest*4 rest.right*5 rest*12 rest.squash*3 rest*10 quirk*2 rest*8',
    think: 'rest.lift*3 rest.wleft*4 rest*2 rest.wright*4 rest.lid rest.blink rest.wide*4',
    greet: 'rest.squash*2 step*2 quirk.lift*3 quirk*2 step*2 quirk*3 rest.lid*3 rest*3',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    fly: 'flight0 flight1 flight2 flight3 flight4 flight5 flight6 flight7',
    groom: 'rest*2 rest.nod.blink*3 quirk.nod*3 quirk.blink*2 rest.lid*3 rest*2',
    happy: 'rest.lid*2 quirk.lid*3 step.lid quirk.lid*3 rest.lid*3 rest*2',
  },
  frog: {
    label: 'Frog', note: 'Patient until it springs. Puffs a round throat, crouches before each hop and settles on splayed toes.',
    tempo: 1.08, belly: 24, head: 19, speed: 1.1, habits: ['sniff', 'look', 'stretch'],
    idle: 'rest*24 rest.blink rest*16 quirk*3 quirk.squash*2 quirk*3 rest*12 rest.lid rest.blink rest*12',
    think: 'rest*3 quirk*3 rest*2 quirk.wide*4 rest.wleft*3 rest.wright*3 rest*2',
    greet: 'rest*2 rest.squash*3 step.hop stride.hop2*2 step.hop rest.squash*2 quirk*3 rest*3',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    happy: 'rest.squash*2 step.lid.hop stride.lid.hop2*2 rest.squash quirk.lid*3 rest*2',
    stretch: 'rest*3 quirk*3 quirk.stretch*3 quirk*2 rest*3',
  },
  cat: {
    label: 'Cat', note: 'Quietly curious. Follows your hand, answers with a slow blink and curls its tail when pleased.',
    tempo: 1.16, belly: 23, head: 17, speed: 1.05, habits: ['groom', 'stretch', 'look'],
    idle: 'rest*22 rest.lid*2 rest.blink rest.lid*2 rest*15 quirk*5 rest*6 quirk*3 rest*12 rest.squash*3 rest*8',
    think: 'rest.wleft*4 quirk.wleft*3 rest*2 rest.wright*4 quirk.wright*3 rest.lift*3',
    greet: 'rest*2 rest.stretch*3 quirk.lift*3 quirk.lid*3 quirk.blink*2 rest.lid*3 rest*2',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    groom: 'rest.nod*2 step.nod*3 step.blink*2 rest*2 step.nod*3 rest.lid*3 rest*2',
    happy: 'rest.lid*3 quirk.lid*4 quirk.blink*2 quirk.lid*3 rest.lid*4 rest*2',
  },
  bear: {
    label: 'Bear', note: 'A gentle heavyweight. Sniffs the air, takes unhurried steps and lifts a big padded paw for hello.',
    tempo: 1.3, belly: 24, head: 19, speed: 0.7, habits: ['sniff', 'stretch', 'look'],
    idle: 'rest*18 rest.squash*3 rest*12 rest.lift*3 rest*5 rest.blink rest*14 rest.left*4 rest*8 quirk*3 rest*8',
    think: 'rest.nod*3 rest.wleft*4 rest*2 rest.lift*3 rest.wright*4 rest*3',
    greet: 'rest*2 quirk*3 quirk.lift*2 quirk*3 quirk.lift*2 quirk*2 rest.lid*3 rest*2',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    happy: 'rest.lid*2 quirk.lid*3 quirk.lift.lid*3 quirk.lid*2 rest.lid*4 rest*2',
  },
  slime: {
    label: 'Slime', note: 'A soft little jelly creature. Big glistening eyes, a shy smile and a squishy body that settles into a wide, wobbly mound.',
    tempo: 0.94, belly: 24, head: 22, speed: 0.8, habits: ['stretch', 'look', 'sniff'],
    idle: 'rest*10 rest.squash*3 rest*6 rest.stretch*3 rest*10 rest.blink rest*6 quirk*3 quirk.squash*2 rest*8',
    think: 'rest*2 rest.flush*2 rest.flush2*2 quirk.flush*3 rest.wleft*3 rest.wright*3 rest*3',
    greet: 'rest.squash*3 step*2 stride*2 quirk.stretch*3 rest.squash*2 rest*3',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7 travel8 travel9 travel10 travel11 travel12 travel13 travel14 travel15 travel16 travel17 travel18 travel19 travel20 travel21 travel22 travel23',
    happy: 'rest.squash*2 step stride.lid*2 quirk.lid*3 rest.squash*2 rest*3',
    sniff: 'rest*3 rest.stretch*3 quirk*3 rest.squash*2 rest*3',
  },
  fox: {
    label: 'Fox', note: 'All ears and mischief. Tests the air, pricks up at a new sound and sweeps a white-tipped brush behind it.',
    tempo: 0.96, belly: 23, head: 19, speed: 1.2, habits: ['sniff', 'look', 'groom'],
    idle: 'rest*14 rest.left*3 rest*3 rest.right*3 rest*9 quirk*4 rest*5 quirk*2 rest.blink rest*16',
    think: 'rest.lift*2 quirk.wright*4 rest*2 rest.wleft*4 quirk.lift*3 rest*2',
    greet: 'rest.squash*2 quirk.stretch*3 quirk.wide*3 rest.lid*2 quirk*3 rest*2',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    happy: 'quirk.lid*3 rest.lid*2 quirk.lid*3 rest.lid*2 quirk.lift*2 rest*3',
  },
  rabbit: {
    label: 'Rabbit', note: 'A soft-footed scout. One ear folds as it listens, its nose twitches and its great back feet spring together.',
    tempo: 0.88, belly: 23, head: 21, speed: 1.15, habits: ['sniff', 'groom', 'look'],
    idle: 'rest*12 rest.nod rest*3 rest.nod rest*8 quirk*5 rest*12 rest.blink rest*8 quirk*3 rest*7',
    think: 'quirk*3 quirk.wleft*3 rest.lift*2 rest.wright*3 quirk.wide*3 rest*2',
    greet: 'rest.squash*2 step.hop stride.hop2*2 rest.squash*2 quirk.lid*3 rest*3',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    happy: 'rest.squash*2 step.hop stride.lid.hop2*3 rest.squash*2 quirk.lid*3 rest*2',
  },
  raccoon: {
    label: 'Raccoon', note: 'An inquisitive night-shift helper. Inspects a tiny treasure between its paws, then peeks up to check on you.',
    tempo: 1.02, belly: 23, head: 21, speed: 0.95, habits: ['groom', 'look', 'sniff'],
    idle: 'rest*12 quirk*4 quirk.nod*3 quirk*4 rest*10 rest.blink rest*8 rest.left*3 rest*8',
    think: 'quirk.nod*3 quirk*2 quirk.wleft*3 quirk.wright*3 rest.lift*3 rest*2',
    greet: 'rest*2 quirk*3 quirk.lift*3 quirk.wide*3 rest.lid*2 rest*3',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    groom: 'quirk.nod*3 quirk*2 quirk.nod*3 quirk.lid*3 rest*3',
    happy: 'quirk.lid*3 quirk.lift*2 quirk.lid*3 rest.lid*3 rest*2',
  },
  penguin: {
    label: 'Penguin', note: 'A very earnest usher. Waddles from foot to foot, smooths its bib and raises one flipper in a cheerful salute.',
    tempo: 1.05, belly: 24, head: 18, speed: 0.75, habits: ['groom', 'look', 'stretch'],
    idle: 'rest*14 rest.squash*2 rest*8 step*2 rest*6 stride*2 rest*10 rest.blink rest*8 quirk*3 rest*6',
    think: 'rest.wleft*3 step*2 rest.wright*3 stride*2 rest.lift*3 rest*3',
    greet: 'rest*2 quirk*3 quirk.lift*2 quirk*3 rest.lid*3 rest*2',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    happy: 'rest.lid*2 step.lid*2 quirk.lid*3 stride.lid*2 quirk.lid*3 rest*2',
  },
  axolotl: {
    label: 'Axolotl', note: 'A smiling water sprite. Ripples its feathery gills, paddles on tiny feet and lifts its whole frill to greet you.',
    tempo: 0.98, belly: 24, head: 21, speed: 0.9, habits: ['stretch', 'look', 'sniff'],
    idle: 'rest*12 quirk*3 rest*5 quirk.nod*2 rest*10 rest.blink rest*8 rest.squash*2 quirk*3 rest*9',
    think: 'quirk*3 rest*2 quirk.wide*3 rest.wleft*3 rest.wright*3 quirk*2 rest*2',
    greet: 'rest.squash*2 quirk*3 quirk.lift*3 rest.lid*2 quirk.lid*3 rest*3',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    happy: 'rest.lid*2 quirk.lid*3 rest.lid*2 quirk.lift.lid*3 rest*3',
  },
  dragon: {
    label: 'Dragon', note: 'A tiny guardian with oversized courage. Flexes its sail-like wings, stretches its striped belly and makes short flights.',
    tempo: 1.18, belly: 23, head: 20, airborne: true, speed: 1.15, habits: ['flutter', 'stretch', 'look'],
    idle: 'rest*16 rest.lift*3 rest*10 quirk*3 rest*6 rest.blink rest*10 rest.squash*3 rest*8 quirk*2 rest*7',
    think: 'rest.lift*3 rest.wright*3 quirk*3 rest.wleft*3 quirk.wide*3 rest*3',
    greet: 'rest.squash*2 quirk*3 quirk.hop*2 quirk*3 rest.lid*3 rest*3',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    fly: 'flight0 flight1 flight2 flight3 flight4 flight5 flight6 flight7',
    happy: 'rest.squash*2 quirk.lid.hop*3 quirk.lid*3 rest.lid*3 rest*2',
  },
  wizard: {
    label: 'Wizard', note: 'A wandering spellkeeper. Peers out beneath a crooked hat, rests on a staff and raises one hand to kindle a little star.',
    tempo: 1.24, belly: 24, head: 19, speed: 0.65, habits: ['look', 'groom', 'stretch'],
    idle: 'rest*20 rest.lid rest.blink rest*12 rest.nod*2 rest*10 rest.left*4 rest*6 rest.right*4 rest*12 quirk*3 rest*8',
    think: 'rest.nod*3 rest.wleft*4 rest*2 quirk*3 quirk.wright*4 rest.lift*2 rest*3',
    greet: 'rest*3 rest.lift*2 quirk*4 quirk.lift*2 quirk*4 rest.lid*3 rest*3',
    walk: 'travel0 travel1 travel2 travel3 travel4 travel5 travel6 travel7',
    happy: 'rest.lid*2 quirk.lid*3 quirk.lift.lid*3 quirk.lid*3 rest.lid*3 rest*2',
    groom: 'rest.nod*3 rest.lid*2 rest.nod*3 rest*3',
    stretch: 'rest*2 rest.stretch*3 quirk.stretch*3 quirk*2 rest*3',
  },
};

/** Roster order. This is the order the picker shows them in. */
const NAMES = Object.keys(ANIMALS);

/** The fallback for a sprite name nothing recognises. */
const FALLBACK = 'cat';

/* ── Grid transforms ──────────────────────────────────────────────────────
 *
 * Every one takes a 32-row grid and returns a 32-row grid. That invariant is
 * asserted in the tests: a transform that changes the row count makes the
 * whole strip drift, one frame at a time, and it looks like a rendering bug
 * rather than a data bug.
 */

/** Find actual eye components, not every row containing an eye colour. This
 * keeps a lid one pixel high and preserves the owl's pale facial discs. The
 * old blink erased the pupils into body colour, so faces lost their eyes.
 */
function eyeGroups(grid) {
  const seen = new Set(), groups = [];
  grid.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!['e', 'h'].includes(ch) || seen.has(y * SIZE + x)) return;
    const group = [], queue = [[x, y]];
    while (queue.length) {
      const [px, py] = queue.pop(), key = py * SIZE + px;
      if (seen.has(key) || !['e', 'h'].includes(grid[py]?.[px])) continue;
      seen.add(key); group.push([px, py]);
      queue.push([px - 1, py], [px + 1, py], [px, py - 1], [px, py + 1]);
    }
    groups.push(group);
  }));
  return groups;
}

function eyeFill(grid, x, y) {
  for (let d = 1; d < SIZE; d++) {
    for (const xx of [x - d, x + d]) if (['b', 's'].includes(grid[y]?.[xx])) return grid[y][xx];
  }
  return 'b';
}

function closeEyes(grid) {
  const out = grid.map(row => [...row]);
  for (const group of eyeGroups(grid)) {
    const bottom = Math.max(...group.map(([, y]) => y));
    for (const [x, y] of group) out[y][x] = y === bottom ? 'e' : eyeFill(grid, x, y);
  }
  return out.map(row => row.join(''));
}

/** A half lid lowers the upper edge, then a full blink closes to one line. */
function lidEyes(grid) {
  const out = grid.map(row => [...row]);
  for (const group of eyeGroups(grid)) {
    const top = Math.min(...group.map(([, y]) => y));
    for (const [x, y] of group) if (y === top) out[y][x] = 'o';
  }
  return out.map(row => row.join(''));
}

/**
 * Eyes one pixel taller — alert, surprised, or looking at you.
 *
 * It grows UPWARD only, and only into face — body or shading. Growing in every
 * direction turns a small eye into a hole and the animal reads as a skull;
 * growing into the outline punches through the silhouette. Shading counts
 * because the owl's eyes sit inside facial discs and the bat's inside a
 * muzzle: when this only accepted body, both of them widened their eyes by
 * doing nothing at all.
 */
const FACE = new Set(['b', 's']);

function wideEyes(grid) {
  const out = grid.map((row) => [...row]);
  grid.forEach((row, y) => {
    if (y === 0) return;
    [...row].forEach((ch, x) => {
      if (ch === 'e' && FACE.has(grid[y - 1][x])) out[y - 1][x] = 'e';
    });
  });
  return out.map((row) => row.join(''));
}

/**
 * Look sideways: slide every eye one pixel, but only onto body.
 *
 * An eye that would land on the outline or off the face stays put, which is
 * why an animal whose eyes sit against the edge simply does not look that way
 * rather than growing a third eye in its cheek.
 *
 * It is a SWAP, not a move: the vacated pixel takes whatever colour the eye
 * displaced. Writing body back unconditionally left a primary-coloured dot in
 * the middle of the owl's facial disc every time it glanced sideways.
 */
function gaze(grid, dx) {
  if (!dx) return grid;
  const out = grid.map(row => [...row]);
  // Move a whole pupil or leave it in place. Moving just its leading edge
  // splits a two-pixel pupil into two eyes with a face-coloured hole between.
  for (const group of eyeGroups(grid)) {
    if (!group.every(([x, y]) => ['e', 'h'].includes(grid[y]?.[x + dx]) || FACE.has(grid[y]?.[x + dx]))) continue;
    for (const [x, y] of group) out[y][x] = eyeFill(grid, x, y);
    for (const [x, y] of group) out[y][x + dx] = grid[y][x];
  }
  return out.map(row => row.join(''));
}

/**
 * A sleeping face: eyes closed, and a line drawn across where they were.
 *
 * Drawn rather than merely closed because a closed eye and an eye that is
 * simply missing look identical, and the sleeping state has a job — it means
 * the model is unreachable, and an operator has to be able to tell that at a
 * glance from across a room.
 */
function sleepFace(grid) {
  const out = closeEyes(grid);
  return out.map(row => row.replace(/e/g, 'o'));
}

/** Shift the whole animal down one row — the bottom of a breath, or a landing. */
function down(grid) {
  return [BLANK, ...grid.slice(0, grid.length - 1)];
}

/** Shift the whole animal up one row — a hop. */
function up(grid) {
  return [...grid.slice(1), BLANK];
}

/**
 * Move a BAND of rows and leave the rest where it is.
 *
 * This is what a full body bought. Shifting the whole sprite reads as the
 * animal jumping, because every part of it moves together; shifting rows 0..18
 * moves the head and the shoulders while the haunches and paws stay planted,
 * which is what a nod actually looks like. The row vacated at the seam is
 * filled from the row the band left behind, so the neck does not tear open.
 */
function shiftRows(grid, y1, dy) {
  const out = grid.slice();
  if (dy > 0) {
    for (let y = y1; y >= 0; y -= 1) out[y] = y - dy >= 0 ? grid[y - dy] : BLANK;
  } else {
    for (let y = 0; y <= y1; y += 1) out[y] = grid[y - dy] || BLANK;
  }
  return out;
}

/**
 * Squash: take one row out of the middle and give it back at the top.
 *
 * This is the breath, and it is the reason the animals stopped looking like
 * cardboard cutouts on a stick. Removing a row of belly moves the head and the
 * shoulders while the feet stay planted, which is what breathing looks like.
 */
function compress(grid, cut) {
  return [BLANK, ...grid.slice(0, cut), ...grid.slice(cut + 1)];
}

/** Stretch: duplicate the belly row, so the top half rises. The inhale. */
function expand(grid, cut) {
  return [...grid.slice(1, cut + 1), grid[cut], ...grid.slice(cut + 1)];
}

/**
 * Rotate the three body colours and leave the face alone.
 *
 * The first transform in this file that changes COLOUR rather than geometry,
 * and it exists because one animal's real behaviour is exactly this: a
 * cuttlefish thinks by running a pattern over its skin, and the palette it
 * would run is the operator's, already solved against their background. It
 * cost no art at all — three grids in, three grids out.
 *
 * Eyes and mouth are excluded deliberately. `e` is `--bg`, and it is the whole
 * reason a face reads at 32px; rotating it into a body colour blinds the
 * animal for two frames, which looks like a rendering fault rather than a
 * flush. `m` is excluded because `openMouth` has to keep being able to find
 * it — a mouth that turned into a body colour mid-sentence stopped opening.
 */
const FLUSH = { b: 's', s: 'n', n: 'b' };
const FLUSH_BACK = { b: 'n', n: 's', s: 'b' };

function flushColours(grid, map) {
  return grid.map((row) => [...row].map((ch) => map[ch] || ch).join(''));
}

/**
 * A 4x4 ordered dither, for the teleport.
 *
 * The companion leaves the navbar by DISSOLVING rather than fading: opacity on
 * a pixel sprite is a smudge, and a sprite that shrinks is a sprite falling
 * over. Thresholding against an ordered matrix drops pixels in the scattered,
 * even pattern that reads as a pixel-art teleport — and it is the same trick,
 * and the same matrix, that every 8-bit machine used for exactly this.
 *
 * Ordered rather than random on purpose: a random mask would differ every time
 * the frame was derived, so the pose cache would hand out a different sprite to
 * the navbar and the preview card, and neither would match itself on a
 * re-render.
 */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

/** Drop every pixel whose dither value is under `level` (0 whole, 16 gone). */
function dissolve(grid, level) {
  return grid.map((row, y) => [...row]
    .map((ch, x) => (BAYER[y % 4][x % 4] < level ? '.' : ch))
    .join(''));
}

/**
 * Lean the upper body sideways.
 *
 * Used when the companion props itself against the search field while somebody
 * is typing. It shifts the head band horizontally and leaves the feet where
 * they are, which is what leaning is; shifting the whole sprite would just be
 * standing somewhere else.
 */
function tiltRows(grid, y1, dx) {
  return grid.map((row, y) => {
    if (y > y1) return row;
    if (dx > 0) return BLANK.slice(0, dx) + row.slice(0, row.length - dx);
    return row.slice(-dx) + BLANK.slice(0, -dx);
  });
}

/**
 * An open mouth, for the talking frames.
 *
 * `m` pixels become the eye colour, which reads as an opening because the body
 * is `--primary` and the eye colour is `--bg`.
 */
function openMouth(grid) {
  return grid.map((row) => (row.includes('m') ? row.replace(/m/g, 'e') : row));
}

/* ── Poses ──────────────────────────────────────────────────────────────── */

/**
 * The modifiers a sequence token may apply, and they COMPOSE.
 *
 * `quirk.lift.wide` is the quirk pose with its head raised a pixel and its
 * eyes widened. Four drawn grids and this table are where a few hundred
 * distinct frames per animal come from, none of which had to be drawn.
 */
const MODS = {
  low: (g) => down(g),
  hop: (g) => up(g),
  hop2: (g) => up(up(g)),
  squash: (g, a) => compress(g, a.belly),
  stretch: (g, a) => expand(g, a.belly),
  nod: (g, a) => shiftRows(g, a.head, 1),
  lift: (g, a) => shiftRows(g, a.head, -1),
  blink: (g) => closeEyes(g),
  lid: (g) => lidEyes(g),
  wide: (g) => wideEyes(g),
  left: (g) => gaze(g, -1),
  right: (g) => gaze(g, 1),
  wleft: (g) => gaze(wideEyes(g), -1),
  wright: (g) => gaze(wideEyes(g), 1),
  talk: (g) => openMouth(g),
  // Colour, not geometry — see flushColours. Written last in a token
  // (`rest.wide.flush`) because `wide` has to find body above an eye before
  // the rotation moves it.
  flush: (g) => flushColours(g, FLUSH),
  flush2: (g) => flushColours(g, FLUSH_BACK),
  shut: (g) => sleepFace(g),
  // Tilts BACKWARD, away from the way it is facing. The companion reaches the
  // search field from the right and so arrives facing left; the sprite is
  // mirrored for that, which turns this -2 into a lean to the right — back
  // against the end of the field, looking out along the bar. Tilting +2 leant
  // it into thin air.
  lean: (g, a) => tiltRows(g, a.head, -2),
  // Five steps of teleport. Named rather than parameterised so a sequence
  // stays a list of poses and the pose cache can key on the token.
  fade1: (g) => dissolve(g, 3),
  fade2: (g) => dissolve(g, 6),
  fade3: (g) => dissolve(g, 9),
  fade4: (g) => dissolve(g, 12),
  fade5: (g) => dissolve(g, 16),   // 16 beats every value in the matrix: gone
};


/**
 * Resolve one token — `quirk.lift.wide` — to a frame, memoised per animal.
 *
 * The cache is what lets a repeat be free and the renderer's dedupe work: the
 * same token anywhere in any sequence yields the SAME array, so a pose held
 * for ten ticks is one copy of the rects and ten `<use>` elements.
 */
function poseOf(name, token, cache) {
  if (cache.has(token)) return cache.get(token);
  const animal = ANIMALS[Object.hasOwn(ANIMALS, name) ? name : FALLBACK];
  const [base, ...mods] = token.split('.');
  if (!BASES.includes(base) && !Object.hasOwn(TRAVEL_ART, `${name}_${base}`)) throw new Error(`Unknown pose "${base}" in "${token}"`);
  let grid = TRAVEL_ART[`${name}_${base}`] || ART[`${Object.hasOwn(ANIMALS, name) ? name : FALLBACK}_${base}`];
  for (const mod of mods) {
    if (!MODS[mod]) throw new Error(`Unknown modifier "${mod}" in "${token}"`);
    grid = MODS[mod](grid, animal);
  }
  cache.set(token, grid);
  return grid;
}

/**
 * The states every animal shares, in the same notation the animals use.
 *
 * Sleep, talk and perk are the same for everybody on
 * purpose. Sleep is a STATUS — "the model is unreachable" — and a status that
 * looked different per animal would be a status people had to learn eight
 * times. Talk follows the audio, and a mouth is a mouth. What varies is only
 * the tempo, which every animal already carries.
 */
const SHARED = {
  sniff: 'rest*2 rest.lift*2 rest.nod rest.lift*2 rest.wright*3 rest.wleft*3 rest*3',
  stretch: 'rest.squash*3 rest.stretch*4 quirk.stretch*3 rest.lift*2 rest*3',
  groom: 'rest.nod*2 quirk.nod*3 rest.blink*2 quirk.nod*3 rest*3',
  look: 'rest.left*4 rest*2 rest.right*4 rest.wide*2 rest*4',
  // A potter: out a few pixels, a look about, and back to the button.
  //
  // It replaced a state called `shuffle`, whose frames were this same walk
  // cycle played ON THE SPOT while the CSS rocked the whole sprite left and
  // right. Two problems with that, and the second is the reason for the
  // rename. It read as an egg wobbling rather than an animal walking, because
  // nothing in the world moved past it. And a state called "shuffle" that
  // travels nowhere is a name that describes the frames instead of the
  // behaviour — so the excursion in 105-ai-companion-life.css and this
  // sequence are now one thing with one name, and they share a duration
  // (`--potter-ms`) so the feet and the travel cannot drift apart.
  //
  // This is what a store with roaming switched OFF gets: the companion stays
  // its own button's width from home, which is a different promise from
  // walking the whole bar and is the operator's to keep either way.
  potter: 'rest step.low step step.nod step rest step.low step step.nod step rest*2',
  flutter: 'rest.squash*2 quirk.hop*2 rest.hop2 quirk.hop2*2 rest.hop quirk.hop*2 rest*3',
  fly: 'quirk.hop*2 rest.hop2 quirk.hop2*2 rest.hop quirk.hop*2 rest.hop2',
  // Grinding a proof of work, or an operator index job. Head down and the
  // whole body pumping on a beat: it has to be unmistakably NOT `think`,
  // because the two mean different things. Thinking is the model composing a
  // sentence; working is arithmetic, in this browser or on the operator's own
  // box, and nobody is waiting on a sentence for it.
  work: 'rest.nod.squash*2 rest.nod*2 step.nod.squash*2 step.nod*2 rest.nod*2 rest.nod.squash*2',
  // The transcript just cleared itself. A yawn is the honest way to show a
  // privacy guarantee happening: something WAS there and now is not, and the
  // animal is the only thing on the page that can say so without writing the
  // vanished conversation down again in order to explain it.
  yawn: 'rest.talk*2 rest.talk.lift*3 rest.talk.stretch*2 rest.lid*3 rest.blink*2 rest*3',
  sleep: 'rest.low.shut*4 rest.low.shut.squash*3 rest.low.shut*4 rest.low.shut.squash*3 '
       + 'rest.low.shut*4 rest.low.shut.nod*3',
  talk: 'rest.talk rest rest.talk rest.talk.nod rest rest.talk rest.talk.nod rest.talk rest rest.talk',
  perk: 'rest.lift.wide*3 rest.wide*3 rest.lift.wide*2 rest.wide*2 rest.wleft*3 rest.wide*2 '
      + 'rest.wright*3 rest.wide*3 rest.lift.wide*2',
  happy: 'rest.lid.squash rest.lid.hop rest.lid.hop2*2 rest.lid.hop rest.lid rest.lid.squash '
       + 'rest.lid.hop rest.lid.hop2*2 rest.lid.hop rest.lid rest.wide*2 rest*2',
  // A walk on the spot: contact, pass, contact, pass, with the body dropping a
  // pixel on each contact. Two drawn poses and a shift is a whole cycle.
  walk: 'rest step.low step step.nod rest rest.low step.low step step.nod rest.nod rest step.low',
  // Propped against the search field while somebody types. It still breathes
  // and still blinks — a companion that froze while leaning would read as a
  // rendering bug rather than as leaning.
  lean: 'rest.lean*6 rest.lean.nod*3 rest.lean*5 rest.lean.blink rest.lean*7 rest.lean.squash*2 '
      + 'rest.lean*5 rest.lean.lid rest.lean.blink rest.lean*4',
  // Leaving, and arriving. One-shots, and they are the SAME five steps in
  // opposite order, so the two halves of a teleport cannot drift apart.
  vanish: 'rest rest.fade1 rest.fade2 rest.fade3 rest.fade4 rest.fade5',
  arrive: 'rest.fade5 rest.fade4 rest.fade3 rest.fade2 rest.fade1 rest.wide rest.wide rest',
};

/**
 * Turn `'rest*4 rest.blink rest*2'` into frames.
 *
 * A repeat yields the SAME array, not a copy, and so does the same token used
 * twice — both come out of the per-animal pose cache. The renderer depends on
 * it: it dedupes frames by identity, so holding a pose for eight ticks costs
 * eight `<use>` elements and one copy of the rects.
 */
function sequence(spec, name, cache) {
  return spec.trim().split(/\s+/).flatMap((token) => {
    const [tok, times] = token.split('*');
    const pose = poseOf(name, tok, cache);
    const n = times ? Number(times) : 1;
    return Array.from({ length: n }, () => pose);
  });
}

/**
 * How long ONE FRAME is held, per state, before the animal's tempo.
 *
 * A tick rather than a whole-cycle duration, because the sequences differ in
 * length: an owl's idle is seventy frames and a dog's is forty, and if both
 * took five seconds the owl would be running twice as fast as the dog — which
 * is the exact opposite of what their notes promise.
 *
 * These are the frame RATES, and they were doubled when the art went to 32x32.
 * A sixteen-pixel animal could only move in whole-body jumps, so a slow tick
 * hid how coarse it was; a full body nods, shifts its weight and swings a tail
 * a pixel at a time, and at 11 frames a second that reads as motion rather
 * than as a slideshow.
 */
const TICK = {
  idle: 0.09,
  sleep: 0.3,
  think: 0.065,
  talk: 0.06,
  perk: 0.075,
  greet: 0.06,
  happy: 0.05,
  walk: 0.065,
  fly: 0.07, sniff: 0.10, stretch: 0.09, groom: 0.1, look: 0.10, potter: 0.085, flutter: 0.075,
  work: 0.085, yawn: 0.1,
  lean: 0.1,
  // Fast. A teleport that took half a second would read as the sprite
  // struggling rather than as a jump, and this one has to finish before the
  // companion has arrived at the other end.
  vanish: 0.035,
  arrive: 0.04,
};

/** Which states play once and hand back, rather than looping. */
const ONE_SHOT = new Set(['greet', 'happy', 'vanish', 'arrive', 'sniff', 'stretch', 'groom', 'look', 'potter', 'flutter', 'yawn']);

/** Every state name, for the tests and the preview card. */
const STATES = ['idle', 'sleep', 'think', 'talk', 'perk', 'greet', 'happy', 'walk',
  'lean', 'vanish', 'arrive', 'sniff', 'stretch', 'groom', 'look', 'potter', 'flutter', 'fly', 'work', 'yawn'];

/**
 * The animal record for a name, falling back rather than throwing.
 *
 * A name off the roster is drawn as FALLBACK rather than crashing the page it
 * decorates. `utils/companion.js` is what decides whether an unrecognised name
 * should draw anything at all; by the time a name reaches here, something has
 * already decided it should.
 */
function animalFor(name) {
  return ANIMALS[Object.hasOwn(ANIMALS, name) ? name : FALLBACK];
}

/** One pose cache per animal, built on first use and kept for the session. */
const CACHES = new Map();
function cacheFor(name) {
  if (!CACHES.has(name)) CACHES.set(name, new Map());
  return CACHES.get(name);
}

/**
 * Frames and timing for one animal in one state.
 *
 * Returns the duration as well as the frames because the two must agree: the
 * renderer drives a CSS `steps(n)` animation, and a state whose frame count
 * and step count disagree flickers. This function is the only place that
 * decides either.
 */
function framesFor(name, state = 'idle') {
  const key = Object.hasOwn(ANIMALS, name) ? name : FALLBACK;
  const animal = ANIMALS[key];
    // `still` is the picker's state: one frame and no animation at all. A
  // roster looping side by side is noise rather than a choice, and it would
  // put thousands of rects on the account page for a control somebody uses
  // once. The picker brings one to life under the cursor instead, which is
  // DESIGN §4's disclosure rather than a wall of motion.
  if (state === 'still') return { frames: [ART[`${key}_rest`]], duration: 0, loop: false };
  const spec = ((state === 'potter' || (state === 'fly' && !animal.airborne)) ? animal.walk : null)
    || (Object.hasOwn(animal, state) ? animal[state] : null)
    || (Object.hasOwn(SHARED, state) ? SHARED[state] : null) || animal.idle;
  const frames = sequence(spec, key, cacheFor(key));
  // A full jelly rotation covers roughly its circumference at roaming speed.
  // More intermediate angles keep that slower roll fluid instead of spinning.
  const tick = key === 'slime' && ['walk', 'potter', 'fly'].includes(state) ? 0.1 : TICK[state] ?? TICK.idle;
  return {
    frames,
    // Rounded to milliseconds: an un-rounded float here produces a duration
    // string like `4.784999999999999s`, which is valid CSS and unreadable in
    // devtools when somebody is trying to work out why a loop feels wrong.
    duration: Math.round(frames.length * tick * animal.tempo * 1000) / 1000,
    loop: !ONE_SHOT.has(state),
  };
}

/**
 * Turn a grid into the fewest rectangles that draw it.
 *
 * Greedy: from each cell not yet covered, run right as far as the colour
 * holds, then run DOWN as far as that whole width holds, and claim the block.
 *
 * The 16x16 version only merged horizontally, with a comment saying vertical
 * merging was "a rectangle-covering problem for a saving nobody would
 * measure". At 32x32 the saving is measurable and it is the difference between
 * shipping this and not: an animal is mostly one big flat body, so horizontal
 * runs alone gave about 155 rects a frame and ten distinct frames put **1550
 * `<rect>` elements in the navbar of every page in the shop**. Claiming blocks
 * instead gives roughly a third of that for about fifteen lines.
 *
 * It is greedy rather than optimal on purpose. The optimal cover is a much
 * harder problem, the difference is a handful of rectangles, and this runs
 * once per distinct frame per animal for the life of the tab.
 */
function runsOf(grid) {
  const h = grid.length;
  const w = grid[0].length;
  const taken = grid.map(() => new Array(w).fill(false));
  const runs = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const ch = grid[y][x];
      if (ch === '.' || taken[y][x]) continue;
      let width = 1;
      while (x + width < w && grid[y][x + width] === ch && !taken[y][x + width]) width += 1;
      let height = 1;
      for (let y2 = y + 1; y2 < h; y2 += 1) {
        let ok = true;
        for (let x2 = x; x2 < x + width; x2 += 1) {
          if (grid[y2][x2] !== ch || taken[y2][x2]) { ok = false; break; }
        }
        if (!ok) break;
        height += 1;
      }
      for (let y2 = y; y2 < y + height; y2 += 1) {
        for (let x2 = x; x2 < x + width; x2 += 1) taken[y2][x2] = true;
      }
      runs.push({
        x, y, width, height, ch,
      });
    }
  }
  return runs;
}

/**
 * One SVG path per palette index, for a whole frame.
 *
 * The rectangles are the right MODEL and the wrong ELEMENT. Emitting 130
 * `<rect>` nodes a frame put over a thousand of them behind the navbar of
 * every page, and most of that is the auto-outline: a one-pixel border
 * following a curve cannot merge into anything bigger, so it fragments every
 * row it crosses.
 *
 * A path does not care. Each rectangle becomes four commands in a `d` string,
 * every rectangle of one colour joins one subpath, and a frame goes from about
 * 130 elements to at most six — one per palette index that appears in it. The
 * browser parses a long attribute far more cheaply than it builds a hundred
 * nodes, and `shape-rendering: crispEdges` keeps the edges hard either way.
 *
 * Returned as pairs rather than an object so the order is the palette's order
 * and therefore stable: the outline has to be drawn before the body, or a
 * shape's border paints over its own fill.
 */
function pathsOf(grid) {
  const by = new Map();
  for (const r of runsOf(grid)) {
    const d = `M${r.x} ${r.y}h${r.width}v${r.height}h${-r.width}z`;
    by.set(r.ch, (by.get(r.ch) || '') + d);
  }
  return [...by.entries()].map(([ch, d]) => ({ ch, d }));
}

export {
  ART, ANIMALS, NAMES, FALLBACK, STATES, SHARED, MODS, BASES, TICK, ONE_SHOT, BLANK, SIZE,
  animalFor, framesFor, poseOf, cacheFor, sequence, runsOf, pathsOf,
  closeEyes, lidEyes, wideEyes, gaze, sleepFace, down, up, shiftRows, tiltRows,
  compress, expand, openMouth, flushColours, dissolve, BAYER,
};
