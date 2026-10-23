/**
 * A small pixel atelier. Coordinates are pixels, never SVG curves: each drawing
 * becomes a 32×32 palette grid before it reaches the renderer. Outlining the
 * union once keeps overlapping cheeks, wings and haunches from growing the
 * double borders that made the old animals look assembled from spare parts.
 * Each species owns its anatomy and four contact/gesture poses.
 */
function canvas() {
  const g = Array.from({ length: 32 }, () => Array(32).fill('.'));
  const dot = (x, y, c = 'b') => { if (x >= 1 && x <= 30 && y >= 3 && y <= 28) g[y][x] = c; };
  const rect = (x, y, w, h, c = 'b') => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) dot(i, j, c);
  };
  const oval = (x, y, w, h, c = 'b') => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      if (((i + .5 - x - w / 2) / (w / 2)) ** 2 + ((j + .5 - y - h / 2) / (h / 2)) ** 2 <= 1) dot(i, j, c);
    }
  };
  const poly = (points, c = 'b') => {
    for (let y = 3; y <= 28; y++) for (let x = 1; x <= 30; x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if ((yi > y + .5) !== (yj > y + .5) && x + .5 < (xj - xi) * (y + .5 - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) dot(x, y, c);
    }
  };
  const eyes = (x, y, h = 2) => { rect(x, y, 2, h, 'e'); rect(30 - x, y, 2, h, 'e'); };
  const mouth = (y, w = 2) => rect(16 - w / 2, y, w, 1, 'm');
  const finish = () => {
    const out = g.map(r => r.slice());
    g.forEach((row, y) => row.forEach((ch, x) => {
      if (ch === '.') return;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (g[y + dy]?.[x + dx] === '.') out[y + dy][x + dx] = 'o';
      }
    }));
    return out.map(r => r.join(''));
  };
  return { dot, rect, oval, poly, eyes, mouth, finish };
}

const DRAW = {
  owl(p) {
    const { rect: r, poly: t, finish } = canvas();
    const wing = p === 'quirk';
    // The original owl's tall mantle, wide gaze and angular facial mask.
    // Folded flight feathers form the sides of the torso, not separate arms.
    t([[9, 13], [23, 13], [25, 18], [26, 22], [25, 26], [22, 28], [10, 28], [7, 26], [6, 22], [7, 18]]);
    if (wing) {
      const feathers = [[11, 16], [3, 8], [2, 14], [3, 20], [5, 18], [6, 23], [8, 21], [10, 25], [12, 23]];
      t(feathers, 's'); t(feathers.map(([x, y]) => [32 - x, y]), 's');
      r(4, 13, 1, 5); r(6, 17, 1, 4); r(8, 20, 1, 3);
      r(27, 13, 1, 5); r(25, 17, 1, 4); r(23, 20, 1, 3);
    } else {
      const folded = [[8, 16], [11, 17], [12, 21], [11, 26], [14, 28], [10, 28], [7, 26], [6, 22], [7, 18]];
      t(folded, 's'); t(folded.map(([x, y]) => [32 - x, y]), 's');
      r(9, 25, 1, 2); r(22, 25, 1, 2);
    }
    t([[8, 3], [10, 5], [12, 8], [14, 7], [18, 7], [20, 8], [22, 5], [24, 3], [24, 11], [25, 12], [24, 16], [21, 17], [11, 17], [8, 16], [7, 12], [8, 11]]);
    t([[10, 9], [13, 9], [16, 11], [19, 9], [22, 9], [24, 12], [23, 15], [20, 17], [16, 16], [12, 17], [9, 15], [8, 12]], 's');
    r(11, 11, 2, 2, 'e'); r(19, 11, 2, 2, 'e');
    r(14, 14, 4, 1, 'n'); r(15, 15, 2, 2, 'm');
    r(13, 18, 1, 2, 's'); r(18, 18, 1, 2, 's'); r(15, 25, 2, 1, 's');
    for (const x of [10, 18]) {
      const y = p === 'step' ? 26 : p === 'stride' ? 27 : 28;
      r(x, y, 4, 1, 'n'); r(x + 1, y, 1, 1, 's');
    }
    // Reflect actual pixels after rasterization: polygon edge rounding and
    // toe shading previously left a visible one-pixel mismatch between sides.
    // Owls use paired foot contacts for their short ground hops.
    return finish().map(row => row.slice(0, 16) + [...row.slice(0, 16)].reverse().join(''));
  },
  frog(p) {
    const { rect: r, poly: t, finish } = canvas();
    const crouch = p === 'step', leap = p === 'stride', puff = p === 'quirk';
    const headY = crouch ? 2 : 0;
    const pair = (points, color = 'b') => {
      t(points, color); t(points.map(([x, y]) => [32 - x, y]), color);
    };
    // A fresh amphibian skeleton: the broad back sits between powerful folded
    // thighs, with the jaw resting directly on the chest. No upright neck.
    pair(leap ? [[10, 18], [7, 18], [3, 22], [2, 25], [5, 25], [9, 22], [12, 23]]
      : [[10, 18], [6, 19], [3, 23], [3, 26], [7, 27], [12, 24]]);
    pair(leap ? [[7, 20], [4, 23], [4, 24], [8, 21], [10, 21]]
      : [[6, 21], [4, 24], [5, 25], [8, 24], [10, 21]], 's');
    t([[10, 13], [22, 13], [25, 19], [23, 24], [20, 27], [12, 27], [9, 24], [7, 19]]);
    // A continuous pale throat widens under the mouth and narrows into the
    // abdomen. Its inflated pose expands sideways, like a vocal sac.
    t(puff ? [[8, 16], [24, 16], [25, 20], [22, 24], [18, 27], [14, 27], [10, 24], [7, 20]]
      : [[9, 16], [23, 16], [22, 21], [19, 26], [13, 26], [10, 21]], 's');
    t([[11, 21], [16, 23], [21, 21], [19, 26], [13, 26]], 'n');
    // Low, wide head with small raised eye sockets. The pupil sits within
    // a side-facing iris, not inside a large human-looking white eyeball.
    t([[8, 9 + headY], [12, 7 + headY], [20, 7 + headY], [24, 9 + headY],
      [27, 13 + headY], [25, 16 + headY], [21, 18 + headY], [11, 18 + headY], [7, 16 + headY], [5, 13 + headY]]);
    pair([[6, 11 + headY], [6, 7 + headY], [8, 5 + headY], [11, 5 + headY], [13, 8 + headY], [12, 12 + headY]]);
    pair([[7, 8 + headY], [8, 7 + headY], [11, 7 + headY], [12, 9 + headY], [11, 12 + headY], [7, 12 + headY]], 's');
    r(8, 8 + headY, 3, 2, 'e'); r(21, 8 + headY, 3, 2, 'e');
    // Small nostrils and a subtle jaw line replace the oversized smile.
    r(12, 12 + headY, 1, 1, 's'); r(19, 12 + headY, 1, 1, 's');
    r(9, 15 + headY, 14, 1, 's'); r(12, 16 + headY, 8, 1, 'm');
    // Forearms angle in toward three webbed digits; separated hind feet
    // stay outside them. The leap extends both hind legs together.
    const footY = leap ? 25 : 28;
    pair([[8, 18 + (crouch ? 1 : 0)], [11, 19], [11, 23], [13, footY], [9, footY], [8, 23]]);
    pair([[9, 20], [10, 21], [10, 24], [11, footY - 1], [9, footY - 1]], 's');
    r(8, footY, 6, 1); r(18, footY, 6, 1);
    for (const x of [8, 10, 12]) { r(x, footY - 1, 1, 1, 's'); r(31 - x, footY - 1, 1, 1, 's'); }
    const rearY = leap ? 25 : 27;
    r(2, rearY, 5, 1); r(25, rearY, 5, 1);
    r(2, rearY - 1, 1, 1, 's'); r(4, rearY - 1, 1, 1, 's');
    r(29, rearY - 1, 1, 1, 's'); r(27, rearY - 1, 1, 1, 's');
    return finish().map(row => row.slice(0, 16) + [...row.slice(0, 16)].reverse().join(''));
  },
  cat(p) {
    const { oval: o, rect: r, poly: t, eyes, finish } = canvas();
    // A narrow neck, sloping shoulders and haunches support the small wedge
    // head. The long tail curls around the feet, with only its tip flicking.
    t([[13, 14], [19, 14], [21, 20], [24, 24], [23, 27], [9, 27], [8, 24], [11, 20]]);
    t([[13, 16], [19, 16], [18, 22], [16, 24], [14, 22]], 's');
    o(8, 21, 6, 7); o(18, 21, 6, 7);
    r(10, 23, 1, 3, 's'); r(21, 23, 1, 3, 's');
    t([[10, 4], [14, 8], [18, 8], [22, 4], [23, 11], [22, 14], [19, 17], [13, 17], [10, 14], [9, 11]]);
    t([[11, 7], [13, 10], [11, 10]], 'n'); t([[21, 7], [19, 10], [21, 10]], 'n');
    r(14, 9, 1, 2, 's'); r(17, 9, 1, 2, 's');
    r(10, 11, 4, 1, 's'); r(18, 11, 4, 1, 's'); eyes(11, 11);
    r(12, 14, 3, 1, 's'); r(17, 14, 3, 1, 's'); r(15, 13, 2, 1, 'n');
    r(15, 14, 2, 1, 'm'); r(14, 15, 1, 1, 'm'); r(17, 15, 1, 1, 'm');
    r(8, 13, 3, 1, 's'); r(21, 13, 3, 1, 's');
    r(12, 20, 3, p === 'step' ? 5 : 8); r(17, 20, 3, p === 'stride' ? 5 : 8);
    r(12, p === 'step' ? 24 : 27, 3, 1, 's'); r(17, p === 'stride' ? 24 : 27, 3, 1, 's');
    r(15, 24, 2, 4, 'o');
    t(p === 'quirk' ? [[23, 27], [25, 25], [25, 20], [27, 18], [29, 19], [28, 21], [27, 21], [27, 26], [25, 28]]
      : [[22, 25], [26, 25], [28, 23], [29, 24], [28, 27], [25, 28], [20, 28], [20, 27]]);
    r(p === 'quirk' ? 27 : 25, p === 'quirk' ? 19 : 26, 2, 1, 's');
    return finish();
  },
  bear(p) {
    const { oval: o, rect: r, poly: t, eyes, mouth, finish } = canvas();
    // Broad shoulders and substantial forearms carry a smaller rounded head.
    o(6, 15, 20, 13); o(11, 18, 10, 9, 's');
    o(5, p === 'quirk' ? 12 : 18, 6, 9); o(21, 18, 6, 9);
    if (p === 'quirk') { o(4, 11, 6, 6, 's'); r(6, 13, 2, 2, 'n'); r(5, 12, 1, 1, 'n'); r(8, 12, 1, 1, 'n'); }
    o(7, 5, 6, 6); o(19, 5, 6, 6); o(9, 7, 2, 2, 'n'); o(21, 7, 2, 2, 'n');
    o(8, 8, 16, 12); r(10, 10, 3, 1, 's'); r(19, 10, 3, 1, 's'); eyes(11, 12);
    o(11, 14, 10, 5, 's'); r(14, 14, 4, 2, 'n'); mouth(18);
    t([[10, 19], [12, 21], [11, 25], [9, 24]], 's');
    t([[22, 19], [20, 21], [21, 25], [23, 24]], 's');
    o(6, p === 'step' ? 24 : 26, 8, 3, 's'); o(18, p === 'stride' ? 24 : 26, 8, 3, 's');
    for (const x of [8, 10, 20, 22]) r(x, (x < 16 && p === 'step') || (x > 16 && p === 'stride') ? 24 : 26, 1, 1, 'n');
    return finish();
  },
  slime(p) {
    const { oval: o, rect: r, poly: t, finish } = canvas();
    const squash = p === 'step', air = p === 'stride';
    const top = squash ? 14 : air ? 7 : 10;
    const bottom = air ? 26 : 28;
    // A soft dome which spreads where it meets the ground, not a sphere.
    // Its broad, nearly flat contact edge stays continuous through the bounce.
    t([[3, bottom - 1], [2, bottom - 4], [3, top + 7], [5, top + 4], [9, top + 1],
      [14, top], [19, top], [24, top + 2], [27, top + 5], [29, bottom - 5],
      [30, bottom - 2], [28, bottom], [7, bottom]]);
    // An off-centre translucent core and curved reflections avoid the strong
    // horizontal stripe that made the last drawing look like a painted ball.
    t([[9, top + 5], [15, top + 3], [22, top + 5], [25, bottom - 6], [24, bottom - 2],
      [19, bottom - 1], [9, bottom - 2], [6, bottom - 5]], 's');
    r(8, top + 2, 4, 1, 's'); r(6, top + 3, 2, 2, 's'); r(4, top + 6, 1, 3, 's');
    r(13, top + 1, 5, 1, 'n'); r(27, bottom - 5, 1, 2, 'n');
    const eyeY = top + (squash ? 4 : 6);
    o(8, eyeY, 4, 5, 'e'); o(20, eyeY, 4, 5, 'e');
    r(9, eyeY, 2, 1, 'h'); r(21, eyeY, 2, 1, 'h');
    r(9, eyeY + 1, 1, 1, 'h'); r(22, eyeY + 1, 1, 1, 'h');
    r(6, eyeY + 5, 2, 1, 'n'); r(24, eyeY + 5, 2, 1, 'n');
    r(15, eyeY + 5, 2, 1, 'm');
    if (p === 'quirk') { r(14, eyeY + 4, 1, 1, 'm'); r(17, eyeY + 4, 1, 1, 'm'); }
    return finish();
  },
  fox(p) {
    const { oval: o, rect: r, poly: t, eyes, mouth, finish } = canvas();
    t(p === 'quirk' ? [[20, 24], [25, 18], [29, 14], [30, 22], [27, 27], [21, 28]]
      : [[19, 24], [26, 21], [30, 20], [29, 26], [25, 28], [19, 28]]);
    t(p === 'quirk' ? [[26, 18], [29, 14], [30, 22], [27, 23], [25, 21]]
      : [[26, 22], [30, 20], [29, 26], [26, 27], [25, 24]], 's');
    o(9, 17, 14, 11); t([[12, 17], [20, 17], [18, 23], [16, 26], [14, 23]], 's');
    t([[8, 11], [8, 3], [14, 9]]); t([[24, 11], [24, 3], [18, 9]]);
    t([[10, 9], [10, 6], [13, 10]], 'n'); t([[22, 9], [22, 6], [19, 10]], 'n');
    t([[9, 8], [23, 8], [26, 13], [21, 17], [16, 20], [11, 17], [6, 13]]);
    t([[8, 14], [12, 14], [16, 17], [20, 14], [24, 14], [20, 18], [16, 20], [12, 18]], 's');
    eyes(11, 11); r(15, 16, 2, 2, 'n'); mouth(18);
    r(11, 22, 3, p === 'step' ? 3 : 6); r(18, 22, 3, p === 'stride' ? 3 : 6);
    r(11, p === 'step' ? 24 : 27, 3, 1, 's'); r(18, p === 'stride' ? 24 : 27, 3, 1, 's');
    return finish();
  },
  rabbit(p) {
    const { oval: o, rect: r, poly: t, eyes, mouth, finish } = canvas();
    o(23, 23, 5, 5, 's'); o(8, 17, 16, 11); o(12, 18, 8, 8, 's');
    o(7, 21, 7, 7); o(18, 21, 7, 7);
    o(p === 'quirk' ? 7 : 10, p === 'quirk' ? 6 : 3, p === 'quirk' ? 7 : 4, p === 'quirk' ? 8 : 12); o(18, p === 'quirk' ? 6 : 3, p === 'quirk' ? 7 : 4, p === 'quirk' ? 8 : 12);
    r(p === 'quirk' ? 10 : 11, p === 'quirk' ? 8 : 5, 1, p === 'quirk' ? 4 : 7, 'n'); r(p === 'quirk' ? 21 : 20, p === 'quirk' ? 8 : 5, 1, p === 'quirk' ? 4 : 7, 'n');
    o(9, 12, 14, 9); eyes(11, 14); o(12, 17, 8, 3, 's'); r(15, 17, 2, 1, 'n'); mouth(19);
    r(9, 17, 2, 1, 's'); r(21, 17, 2, 1, 's');
    o(6, p === 'step' ? 24 : 26, 8, 3, 's'); o(18, p === 'stride' ? 24 : 26, 8, 3, 's');
    r(12, 21, 2, 6); r(18, 21, 2, 6); r(12, 26, 2, 1, 'n'); r(18, 26, 2, 1, 'n');
    r(8, 27, 1, 1, 'n'); r(23, 27, 1, 1, 'n');
    return finish();
  },
  raccoon(p) {
    const { oval: o, rect: r, poly: t, eyes, mouth, finish } = canvas();
    o(20, 22, 10, 6, 's'); r(23, 22, 2, 6); r(27, 23, 2, 4);
    o(8, 17, 16, 11); o(12, 18, 8, 8, 's');
    o(7, 6, 6, 6); o(19, 6, 6, 6); r(9, 8, 2, 2, 'n'); r(21, 8, 2, 2, 'n');
    o(7, 9, 18, 11);
    t([[8, 12], [11, 11], [15, 13], [14, 16], [10, 16], [8, 14]], 's');
    t([[24, 12], [21, 11], [17, 13], [18, 16], [22, 16], [24, 14]], 's');
    eyes(11, 13); o(12, 16, 8, 4, 's'); r(15, 16, 2, 1, 'n'); mouth(19);
    r(9, 17, 2, 1, 'n'); r(21, 17, 2, 1, 'n');
    o(p === 'quirk' ? 12 : 8, 21, 4, 5); o(p === 'quirk' ? 16 : 20, 21, 4, 5);
    if (p === 'quirk') { r(14, 22, 4, 3, 'n'); r(15, 21, 2, 1, 's'); }
    r(10, p === 'step' ? 26 : 28, 4, 1, 's'); r(18, p === 'stride' ? 26 : 28, 4, 1, 's');
    return finish();
  },
  penguin(p) {
    const { oval: o, rect: r, poly: t, eyes, finish } = canvas();
    const wave = p === 'quirk';
    // A rounded hood flows straight into the shoulders, with a large pear-
    // shaped belly. This avoids the thin neck and tiny, featureless face.
    o(7, 12, 18, 16); o(8, 4, 16, 16);
    r(12, 4, 8, 1, 's'); r(10, 5, 2, 1, 's'); r(20, 5, 2, 1, 's');
    t([[11, 13], [21, 13], [23, 19], [23, 23], [21, 26], [18, 28], [14, 28], [11, 26], [9, 23], [9, 19]], 's');
    // Tall face patches join the breast beneath the beak. A narrow central
    // strip of hood separates the eyes, as in the supplied penguin reference.
    t([[10, 8], [13, 8], [14, 10], [14, 13], [16, 15], [18, 13], [18, 10],
      [19, 8], [22, 8], [23, 11], [22, 15], [20, 17], [12, 17], [10, 15], [9, 11]], 's');
    eyes(11, 10, 3);
    r(9, 11, 1, 3, 'n'); r(22, 11, 1, 3, 'n');
    // Outline the short triangular beak so it remains visible even when the
    // operator chooses similar primary and accent colours. Never recolour it.
    t([[13, 13], [19, 13], [20, 14], [18, 17], [14, 17], [12, 14]], 'o');
    r(13, 14, 6, 1, 'n'); r(14, 15, 4, 1, 'm'); r(15, 16, 2, 1, 'm');
    r(14, 18, 4, 1, 'n'); r(15, 19, 2, 1, 'n');
    // Broad flippers taper outward beside the belly; the waving pose keeps
    // its attachment at the shoulder instead of sprouting from the neck.
    t(wave ? [[9, 15], [6, 12], [3, 8], [2, 11], [3, 15], [6, 19], [9, 19]]
      : [[9, 15], [7, 17], [6, 22], [6, 25], [8, 25], [10, 20]]);
    t([[23, 15], [25, 17], [26, 22], [26, 25], [24, 25], [22, 20]]);
    t(wave ? [[3, 10], [4, 12], [6, 15], [5, 15], [3, 12]]
      : [[8, 17], [9, 16], [8, 21], [7, 23], [7, 21]], 's');
    t([[24, 17], [23, 16], [24, 21], [25, 23], [25, 21]], 's');
    // Chunky webbed feet have distinct left/right contacts for the waddle.
    for (const x of [8, 18]) {
      const y = (x === 8 && p === 'step') || (x === 18 && p === 'stride') ? 26 : 28;
      r(x, y - 1, 6, 2, 'o'); r(x + 1, y - 2, 4, 1, 'o');
      r(x + 1, y - 1, 4, 1, 'n'); r(x, y, 6, 1, 'n');
      r(x + 2, y - 1, 2, 1, 's');
    }
    return finish();
  },
  axolotl(p) {
    const { oval: o, rect: r, poly: t, eyes, mouth, finish } = canvas();
    // A low salamander body and translucent tail fin, rather than a seated
    // mammal torso. Three branching gills fan from each side of the head.
    t([[18, 22], [27, p === 'quirk' ? 18 : 22], [30, 25], [26, 28], [18, 27]], 's');
    t([[19, 24], [28, p === 'quirk' ? 21 : 24], [27, 26], [19, 27]]);
    o(9, 18, 14, 10); o(12, 21, 8, 6, 's');
    for (const side of [0, 1]) {
      const mirror = x => side ? 32 - x : x;
      for (const [y, tip] of [[11, 7], [14, 12], [17, 18]]) {
        t([[mirror(9), y], [mirror(p === 'quirk' ? 2 : 3), tip - (p === 'quirk' ? 1 : 0)], [mirror(4), tip + 2], [mirror(9), y + 2]], 'n');
        r(side ? 27 : 4, tip, 1, 2, 's');
      }
    }
    o(6, 10, 20, 10); eyes(10, 13); r(8, 16, 2, 1, 's'); r(22, 16, 2, 1, 's'); mouth(17, 4);
    t([[9, 21], [7, 24], [6, 27], [10, 27], [12, 22]]);
    t([[23, 21], [25, 24], [26, 27], [22, 27], [20, 22]]);
    r(6, p === 'step' ? 25 : 28, 6, 1, 's'); r(20, p === 'stride' ? 25 : 28, 6, 1, 's');
    return finish();
  },
  dragon(p) {
    const { oval: o, rect: r, poly: t, eyes, mouth, finish } = canvas();
    t([[19, 24], [26, 23], [29, 19], [30, 23], [27, 27], [20, 28]]);
    r(27, 23, 2, 1, 'n'); r(25, 25, 2, 1, 'n');
    const left = p === 'quirk' ? [[11, 16], [2, 8], [3, 22], [6, 19], [9, 24], [12, 22]]
      : [[11, 17], [5, 12], [5, 23], [9, 21], [12, 24]];
    t(left, 's'); t(left.map(([x,y]) => [32-x,y]), 's');
    t([[6, 14], [10, 18], [10, 21]], 'n'); t([[26, 14], [22, 18], [22, 21]], 'n');
    o(9, 15, 14, 13); o(12, 18, 8, 9, 's');
    t([[9, 10], [9, 3], [13, 9]], 'n'); t([[23, 10], [23, 3], [19, 9]], 'n');
    t([[10, 8], [22, 8], [24, 12], [22, 17], [19, 19], [13, 19], [10, 17], [8, 12]]);
    r(15, 7, 2, 3, 's'); r(10, 10, 3, 1, 's'); r(19, 10, 3, 1, 's'); eyes(11, 11);
    o(10, 14, 12, 5, 's'); r(12, 15, 1, 1, 'n'); r(19, 15, 1, 1, 'n'); mouth(17, 4);
    r(10, p === 'step' ? 25 : 27, 4, 2, 's'); r(18, p === 'stride' ? 25 : 27, 4, 2, 's');
    r(13, 21, 6, 1); r(13, 23, 6, 1); r(14, 25, 4, 1);
    r(10, p === 'step' ? 26 : 28, 1, 1, 'n'); r(21, p === 'stride' ? 26 : 28, 1, 1, 'n');
    return finish();
  },
  wizard(p) {
    const { oval: o, rect: r, poly: t, eyes, mouth, finish } = canvas();
    const step = p === 'step', stride = p === 'stride', cast = p === 'quirk';
    // Staff and crook behind the hand; its straight shaft stays planted.
    r(5, 11, 2, 18, 'n'); o(3, 8, 6, 6, 'n'); r(5, 10, 2, 2, 'b');
    r(4, 13, 1, 14, 's');
    // A floor-length split robe and two genuinely separate boot contacts.
    t([[12, 17], [21, 17], [23, 22], [26, 28], [18, 28], [16, 25], [14, 28], [9, 28], [12, 22]]);
    t([[13, 19], [15, 20], [13, 27], [10, 28], [11, 24]], 's');
    t([[20, 20], [22, 23], [24, 27], [21, 27], [18, 23]], 's');
    r(10, step ? 26 : 28, 5, 1, 'n'); r(18, stride ? 26 : 28, 6, 1, 'n');
    t([[12, 16], [9, 17], [6, 18], [7, 21], [10, 20], [12, 22]]);
    r(5, 17, 3, 3, 'n'); r(8, 18, 2, 2, 's');
    t(cast ? [[21, 16], [25, 15], [27, 18], [24, 20], [21, 19]]
      : [[21, 16], [24, 18], [25, 23], [22, 24], [20, 20]]);
    r(cast ? 25 : 22, cast ? 15 : 21, 3, 3, 'n');
    // Beard tapers below the face; asymmetric locks read as hair, not a bib.
    r(11, 13, 10, 5); r(10, 14, 2, 6, 's'); r(21, 14, 2, 5, 's');
    eyes(13, 14); r(15, 16, 2, 1, 'n');
    t([[11, 17], [14, 18], [16, 17], [18, 18], [22, 17], [21, 21], [19, 23], [17, 25], [16, 22], [13, 22]], 's');
    r(12, 18, 1, 2, 'b'); r(20, 19, 1, 2, 'b'); mouth(18);
    // A crooked, folded crown with a wide brim and a narrow hat band.
    t([[9, 12], [12, 9], [16, 3], [22, 3], [26, 5], [28, 8], [25, 7], [22, 6], [20, 9], [22, 12]]);
    t([[17, 4], [21, 4], [18, 8], [16, 11], [12, 11]], 's');
    r(12, 10, 9, 1, 'n'); r(8, 12, 17, 1, 'o');
    if (cast) { r(28, 9, 1, 5, 's'); r(26, 11, 5, 1, 's'); r(28, 11, 1, 1, 'n'); }
    return finish();
  },
};

const BASES = ['rest', 'step', 'stride', 'quirk'];
const HEAD_REGIONS = {
  owl: [2, 29, 0, 31], frog: [2, 18, 0, 31], cat: [2, 17, 7, 24],
  bear: [2, 19, 5, 26], fox: [2, 16, 7, 24], rabbit: [2, 20, 0, 31],
  raccoon: [2, 20, 0, 31], penguin: [2, 16, 8, 23],
  axolotl: [3, 19, 0, 31], dragon: [3, 18, 8, 23], wizard: [14, 17, 11, 20],
};

/** Clustered shadow pixels describe fur/feather edges; no random noise, new
 * colour choices or raster assets. Head shading is mirrored with the anatomy. */
function finishFrontal(name, grid) {
  const out = grid.map(row => [...row]);
  if (name !== 'slime') {
    grid.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== 'b' || y < 16) return;
      if (grid[y + 1]?.[x] === 'o' || (grid[y]?.[x + 1] === 'o' && y % 3 !== 0)) out[y][x] = 'd';
      else if (y % 4 === 0 && x % 5 === 2 && grid[y + 1]?.[x] === 'b') out[y][x] = 'd';
    }));
  }
  const regions = HEAD_REGIONS[name] ? [HEAD_REGIONS[name]] : [];
  if (name === 'fox') regions.push([17, 19, 11, 20]);
  for (const [top, bottom, left, right] of regions) {
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x < (left + right + 1) / 2; x++) out[y][left + right - x] = out[y][x];
    }
  }
  // Re-outline after mirroring a region; its boundary can move by one pixel.
  const copy = out.map(row => row.slice());
  copy.forEach((row, y) => row.forEach((ch, x) => {
    if (ch === '.' || ch === 'o') return;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (copy[y + dy]?.[x + dx] === '.') out[y + dy][x + dx] = 'o';
    }
  }));
  return out.map(row => row.join(''));
}
const ART = Object.fromEntries(Object.entries(DRAW).flatMap(([name, draw]) =>
  BASES.map(pose => [`${name}_${pose}`, finishFrontal(name, draw(pose))])));

export { ART, BASES, HEAD_REGIONS, canvas };
