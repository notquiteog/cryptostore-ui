import { canvas } from './spriteArt.js';

// Right-facing anatomy, authored independently from the seated portraits.
// Integer joint positions keep the pixels crisp; eight contact/passing frames
// give each stride weight without smoothing the artwork into a blurred tween.
const SWING = [3, 2, 0, -3, -3, -2, 0, 3];
const LIFT = [0, 0, 0, 0, 1, 2, 2, 1];
const HOP = [0, 0, 1, 3, 4, 3, 1, 0];
const cycle = (i, offset = 0) => (i + offset) % 8;

function quadruped(name, i) {
  const { oval: o, rect: r, poly: t, finish } = canvas();
  const bear = name === 'bear', fox = name === 'fox', raccoon = name === 'raccoon';
  const bob = [0, 0, -1, -1, 0, 0, -1, -1][i];
  const back = bear ? 6 : 8, shoulder = bear ? 21 : 22;
  const leg = (x, phase, far = false) => {
    const f = cycle(i, phase), end = x + SWING[f], y = 28 - LIFT[f];
    t([[x - 1, 20 + bob], [x + 2, 20 + bob], [x + 1, 24], [end + 2, y], [end - 1, y], [x - 1, 24]], far ? 'd' : 'b');
    r(end - 1, y, bear ? 4 : 3, 1, far ? 'd' : 's');
  };
  leg(back + 3, 4, true); leg(shoulder - 2, 0, true);
  // Tail roots stay attached while the tip follows a delayed arc.
  const tip = [0, -1, -2, -1, 0, 1, 2, 1][i];
  if (fox || raccoon) {
    t([[10, 19 + bob], [6, 17], [2, 13 + tip], [1, 18 + tip], [4, 23], [10, 23]], raccoon ? 's' : 'b');
    if (fox) t([[2, 13 + tip], [4, 16 + tip], [4, 20 + tip], [1, 18 + tip]], 's');
    else { r(3, 16 + tip, 2, 4, 'd'); r(6, 19, 2, 4, 'd'); }
  } else if (bear) o(4, 17 + bob, 4, 4, 'd');
  else {
    t([[10, 20 + bob], [5, 20], [3, 16 + tip], [3, 10 + tip], [5, 9 + tip], [6, 11 + tip], [5, 12 + tip], [5, 16 + tip], [7, 18], [10, 18]]);
  }
  o(back, (bear ? 13 : 16) + bob, bear ? 20 : 18, bear ? 11 : 8);
  t([[back + 2, 20 + bob], [24, 20 + bob], [22, 24 + bob], [back + 4, 24 + bob]], 'd');
  r(back + 4, (bear ? 14 : 16) + bob, 7, 1, 's');
  leg(back + 3, 0); leg(shoulder - 2, 4);
  // Different skulls, muzzles and ears, not one profile with different tails.
  if (bear) {
    o(20, 11 + bob, 9, 10); o(21, 9 + bob, 4, 4); r(22, 10 + bob, 1, 2, 's');
    o(25, 16 + bob, 5, 4, 's'); r(29, 16 + bob, 1, 2, 'd');
  } else if (fox) {
    t([[20, 14 + bob], [20, 8 + bob], [24, 11 + bob], [27, 12 + bob], [27, 15 + bob], [30, 17 + bob], [27, 20 + bob], [21, 18 + bob]]);
    t([[23, 16 + bob], [27, 16 + bob], [30, 17 + bob], [27, 20 + bob]], 's');
    r(21, 10 + bob, 1, 3, 'n'); r(29, 17 + bob, 1, 1, 'd');
  } else {
    o(20, 12 + bob, 9, 9);
    if (raccoon) { o(20, 10 + bob, 4, 4); r(22, 14 + bob, 6, 3, 's'); }
    else { t([[20, 14 + bob], [21, 8 + bob], [24, 12 + bob]]); r(22, 10 + bob, 1, 2, 'n'); }
    o(25, 17 + bob, 5, 3, 's'); r(29, 17 + bob, 1, 1, 'd');
  }
  r(25, 14 + bob, 2, 2, 'e'); r(27, 19 + bob, 2, 1, 'm');
  return finish();
}

function hopper(name, i) {
  const { oval: o, rect: r, poly: t, finish } = canvas();
  const rabbit = name === 'rabbit', h = HOP[i], crouch = i === 1 || i === 7;
  const y = 19 - h + (crouch ? 1 : 0);
  const reach = i >= 6 ? 1 : 0;
  if (rabbit) {
    o(4, y, 5, 5, 's'); o(7, y - 5, 17, crouch ? 10 : 12);
    o(8, y, 10, 7); o(11, y + 2, 5, 3, 'd');
    t([[10, y + 4], [14, y + 4], [i > 2 && i < 6 ? 5 : 10, 27 - h], [i > 2 && i < 6 ? 2 : 7, 27 - h], [8, y + 5]], 's');
    o(20, y - 8, 9, 9); o(21, y - 11, 3, 7); o(25, y - 10, 3, 7);
    r(22, y - 10, 1, 4, 'n'); r(26, y - 9, 1, 4, 'n');
    r(25, y - 5, 2, 2, 'e'); r(28, y - 2, 2, 1, 'm');
    t([[21, y], [24, y], [25, y + 4], [i > 2 && i < 6 ? 28 : 25 + reach, 27 - h], [23, 27 - h], [21, y + 4]]);
  } else {
    o(7, y - 1, 18, 8); o(6, y, 11, 8); o(9, y + 2, 6, 4, 's');
    // Fold the ankle below the haunch, then extend the calf and long toes
    // behind the body at takeoff. The old triangle never unfolded visibly.
    const ankle = [11, 13, 8, 4, 3, 5, 8, 10][i];
    const ankleY = 27 - h - (i > 2 && i < 6 ? 1 : 0);
    t([[9, y + 4], [12, y + 5], [ankle + 2, ankleY], [ankle, ankleY + 1], [7, y + 5]], 's');
    r(ankle - 2, ankleY + 1, 5, 1);
    r(ankle - 2, ankleY, 1, 1, 's');
    r(8, y + 4, 2, 1, 'd');
    o(18, y - 5, 12, 8); o(21, y - 8, 6, 6);
    r(22, y - 6, 4, 3, 's'); r(24, y - 6, 2, 2, 'e');
    t([[20, y + 1], [29, y], [27, y + 4], [23, y + 6]], 's');
    r(28, y + 1, 2, 1, 'm'); r(18, y - 1, 2, 1, 'd');
    t([[22, y + 3], [24, y + 3], [26, 27 - h], [29 + reach, 27 - h], [29 + reach, 28 - h], [23, 28 - h]]);
  }
  return finish();
}

function bear(i) {
  const { oval: o, rect: r, poly: t, finish } = canvas();
  const bob = [0, 0, -1, -1, 0, 0, -1, -1][i];
  const paw = (x, offset, far = false) => {
    const f = cycle(i, offset), end = x + Math.round(SWING[f] * .65), y = 28 - LIFT[f];
    t([[x - 2, 20 + bob], [x + 3, 20 + bob], [x + 2, 24], [end + 3, y], [end - 2, y], [x - 2, 24]], far ? 'd' : 'b');
    r(end - 2, y, 5, 1, far ? 'd' : 'b');
    if (!far) { r(end + 1, y, 1, 1, 's'); r(end - 1, y, 1, 1, 's'); }
  };
  paw(9, 4, true); paw(21, 0, true);
  o(3, 18 + bob, 4, 4, 'd');
  // Broad rump, high shoulders and a heavy chest over short, planted paws.
  o(5, 14 + bob, 19, 11); o(14, 11 + bob, 10, 13);
  t([[6, 20 + bob], [21, 20 + bob], [23, 24 + bob], [8, 25 + bob]], 'd');
  r(10, 14 + bob, 6, 1, 's'); r(16, 13 + bob, 3, 1, 's');
  paw(9, 0); paw(21, 4);
  o(19, 11 + bob, 10, 10); o(20, 9 + bob, 5, 5);
  o(21, 10 + bob, 3, 3, 'd'); r(22, 11 + bob, 1, 1, 's');
  o(24, 17 + bob, 6, 5, 's'); r(28, 17 + bob, 2, 2, 'd');
  r(24, 14 + bob, 2, 2, 'e'); r(27, 20 + bob, 2, 1, 'm');
  r(19, 19 + bob, 1, 2, 'd');
  return finish();
}

function penguin(i) {
  const { oval: o, rect: r, poly: t, finish } = canvas();
  const bob = [0, 0, -1, -1, 0, 0, -1, -1][i];
  // A full rounded hood and pear-shaped torso, with no narrow neck or long bill.
  t([[11, 23 + bob], [7, 26 + bob], [13, 26 + bob]], 'd');
  o(10, 13 + bob, 14, 15); o(12, 5 + bob, 13, 14);
  o(16, 15 + bob, 8, 12, 's');
  t([[21, 9 + bob], [24, 9 + bob], [25, 12 + bob], [24, 16 + bob], [21, 18 + bob], [20, 14 + bob]], 's');
  r(17, 6 + bob, 4, 1, 's'); r(22, 10 + bob, 2, 2, 'e');
  t([[25, 13 + bob], [28, 14 + bob], [25, 17 + bob]], 'o');
  r(25, 14 + bob, 3, 1, 'n'); r(25, 15 + bob, 2, 1, 'm');
  r(21, 18 + bob, 2, 1, 'n');
  // The near flipper hangs down the side, moving a pixel with each weight shift.
  const swing = [0, 0, 1, 1, 0, 0, -1, -1][i];
  t([[15, 15 + bob], [18, 17 + bob], [17 + swing, 22 + bob], [14 + swing, 25 + bob], [12 + swing, 24 + bob], [13, 18 + bob]]);
  r(14 + swing, 19 + bob, 1, 4, 'd');
  for (const [x, offset] of [[13, 0], [20, 4]]) {
    const phase = cycle(i, offset), y = 28 - Math.min(1, LIFT[phase]);
    const foot = x + Math.round(SWING[phase] / 3);
    r(foot, y - 1, 3, 1, 'd'); r(foot, y, 5, 1, 'n'); r(foot + 2, y, 2, 1, 's');
  }
  return finish();
}

function owl(i) {
  const { oval: o, rect: r, poly: t, finish } = canvas();
  const bob = [0, 0, -1, -1, 0, 1, 1, 0][i];
  const tipY = [7, 4, 7, 13, 22, 25, 22, 14][i];
  const tipX = [9, 7, 4, 3, 5, 9, 10, 9][i];
  const feather = tipY > 17 ? -1 : 1;
  // Both wings grow from the shoulders. The far fan sits behind the body;
  // the near wing opens feather tips through a full upstroke and downstroke.
  t([[20, 15 + bob], [12, Math.max(4, tipY - 1)], [9, tipY + 3 * feather], [17, 21 + bob]], 'd');
  t([[12, 17 + bob], [3, 20 + bob], [4, 23 + bob], [13, 23 + bob]], 's');
  r(5, 21 + bob, 4, 1, 'd');
  o(9, 13 + bob, 16, 11); o(20, 8 + bob, 9, 12);
  t([[21, 12 + bob], [21, 5 + bob], [25, 10 + bob]]);
  o(23, 10 + bob, 6, 8, 's'); r(25, 12 + bob, 2, 2, 'e');
  r(28, 15 + bob, 2, 1, 'n'); r(28, 16 + bob, 1, 2, 'm');
  // Talons stay tucked instead of marching underneath a flying body.
  r(16, 23 + bob, 3, 1, 'n'); r(19, 22 + bob, 3, 1, 'n');
  t([[19, 15 + bob], [tipX, tipY], [tipX - 2, tipY + 2 * feather], [tipX, tipY + 5 * feather],
    [tipX + 2, tipY + 4 * feather], [tipX + 3, tipY + 7 * feather], [tipX + 5, tipY + 5 * feather], [18, 22 + bob]], 's');
  t([[18, 17 + bob], [tipX + 1, tipY + 3 * feather], [tipX + 3, tipY + 5 * feather], [17, 21 + bob]], 'b');
  return finish();
}

function axolotl(i) {
  const { oval: o, rect: r, poly: t, finish } = canvas();
  const sway = [0, -1, -2, -1, 0, 1, 2, 1][i];
  t([[14, 20], [7, 18 + sway], [2, 18 + sway], [3, 23 + sway], [10, 25], [16, 24]], 's');
  t([[13, 22], [4, 21 + sway], [8, 23 + sway], [14, 24]]);
  o(10, 19, 17, 7); o(20, 16, 10, 8); r(25, 19, 2, 2, 'e'); r(28, 22, 2, 1, 'm');
  for (const [x, phase] of [[12, 0], [22, 4]]) {
    const f = cycle(i, phase); t([[x, 23], [x + 2, 23], [x + SWING[f], 27 - LIFT[f]], [x - 2 + SWING[f], 28 - LIFT[f]], [x - 2, 26]]);
  }
  for (const [yy, tip] of [[17, 13], [19, 17], [21, 23]]) {
    t([[22, yy], [18, tip + (i % 4 === 0 ? 1 : 0)], [18, tip + 2], [23, yy + 1]], 'n');
  }
  r(14, 20, 5, 1, 's'); r(15, 24, 4, 1, 'd');
  return finish();
}

function slime(i) {
  const { oval: o, rect: r, dot, finish } = canvas();
  // Rolling jelly keeps a broad ground contact. Its core and face tumble
  // clockwise through the volume; the silhouette never lifts off the floor.
  const angle = i * Math.PI / 12, lean = Math.round(Math.sin(angle));
  o(3 + lean, 10, 26, 19); r(8, 26, 16, 3);
  o(10 + Math.round(Math.cos(angle) * 2), 16 + Math.round(Math.sin(angle) * 2), 13, 10, 's');
  const mark = (x, y, ch) => {
    const dx = x - 16, dy = y - 19;
    dot(Math.round(16 + dx * Math.cos(angle) - dy * Math.sin(angle)),
      Math.round(19 + dx * Math.sin(angle) + dy * Math.cos(angle)), ch);
  };
  // Specular light stays above the rolling surface, rather than orbiting it.
  r(10 + lean, 12, 6, 1, 's'); r(7 + lean, 14, 2, 2, 's');
  for (let y = 17; y < 20; y++) for (let x = 22; x < 25; x++) mark(x, y, 'e');
  mark(23, 17, 'h'); mark(24, 17, 'h'); mark(25, 21, 'm');
  return finish();
}

function dragon(i) {
  const { oval: o, rect: r, poly: t, finish } = canvas();
  const bob = [0, 0, -1, -1, 0, 1, 1, 0][i];
  const tipY = [7, 3, 6, 12, 21, 24, 20, 12][i];
  const tipX = [10, 9, 6, 4, 5, 8, 11, 11][i];
  const finger = tipY > 17 ? -1 : 1;
  const tail = [0, -1, -2, -1, 0, 1, 2, 1][i];
  // Long trailing tail and arched neck read as a dragon in flight; the belly
  // is carried horizontally and all four claws remain folded underneath.
  t([[15, 16 + bob], [8, 18 + bob], [3, 17 + tail], [1, 14 + tail], [2, 20 + tail], [7, 23 + bob], [16, 22 + bob]]);
  t([[19, 15 + bob], [24, Math.max(4, tipY)], [28, tipY + 5 * finger], [23, 19 + bob]], 'd');
  o(10, 14 + bob, 14, 9);
  t([[19, 17 + bob], [20, 11 + bob], [23, 8 + bob], [27, 10 + bob], [26, 17 + bob], [22, 22 + bob]], 'b');
  t([[21, 14 + bob], [25, 14 + bob], [24, 20 + bob], [20, 23 + bob], [15, 22 + bob]], 's');
  o(22, 8 + bob, 7, 9); o(25, 12 + bob, 5, 5, 's');
  t([[23, 11 + bob], [20, 4 + bob], [24, 7 + bob]], 'n');
  r(25, 10 + bob, 2, 2, 'e'); r(29, 13 + bob, 1, 1, 'd'); r(28, 16 + bob, 2, 1, 'm');
  t([[13, 21 + bob], [16, 21 + bob], [15, 25 + bob], [12, 25 + bob], [14, 23 + bob]]);
  t([[21, 20 + bob], [23, 20 + bob], [23, 24 + bob], [20, 24 + bob], [21, 22 + bob]]);
  r(12, 25 + bob, 2, 1, 'n'); r(20, 24 + bob, 2, 1, 'n');
  // Bat-like membrane and separated fingers, distinct from the owl's fan.
  t([[18, 15 + bob], [tipX, tipY], [tipX - 3, tipY + 1 * finger], [tipX - 2, tipY + 7 * finger],
    [tipX + 1, tipY + 5 * finger], [tipX + 3, tipY + 9 * finger], [tipX + 5, tipY + 6 * finger], [18, 22 + bob]], 's');
  t([[18, 16 + bob], [tipX - 1, tipY + 2 * finger], [tipX + 1, tipY + 5 * finger]], 'd');
  t([[18, 17 + bob], [tipX + 3, tipY + 4 * finger], [tipX + 3, tipY + 7 * finger]], 'b');
  return finish();
}

function wizard(i) {
  const { oval: o, rect: r, poly: t, finish } = canvas();
  const bob = [0, 0, -1, -1, 0, 0, -1, -1][i];
  t([[13, 15 + bob], [22, 15 + bob], [24, 27], [18, 28], [9, 28], [12, 21]]);
  t([[14, 18], [17, 19], [15, 27], [11, 27]], 's');
  for (const [x, phase] of [[13, 0], [20, 4]]) { const f = cycle(i, phase); r(x + SWING[f], 28 - LIFT[f], 4, 1, 'd'); }
  r(27, 12, 1, 16, 'n'); o(25, 9, 5, 5, 'n'); r(27, 10, 1, 2, 'b');
  t([[20, 17 + bob], [25, 17 + bob], [27, 19], [25, 21], [20, 20]]); r(26, 18, 2, 2, 'n');
  r(18, 11 + bob, 7, 7); r(23, 13 + bob, 2, 2, 'e'); r(25, 16 + bob, 2, 1, 'm');
  t([[19, 16 + bob], [22, 17 + bob], [26, 16 + bob], [25, 21 + bob], [22, 24 + bob], [22, 21 + bob], [19, 20 + bob]], 's');
  t([[9, 11 + bob], [14, 8 + bob], [18, 3], [24, 3], [28, 6], [26, 7], [23, 5], [21, 9 + bob], [24, 11 + bob]]);
  t([[17, 5], [20, 4], [17, 9 + bob], [13, 10 + bob]], 's'); r(10, 11 + bob, 15, 1, 'd');
  return finish();
}

const DRAW = {
  cat: i => quadruped('cat', i), bear,
  fox: i => quadruped('fox', i), raccoon: i => quadruped('raccoon', i),
  frog: i => hopper('frog', i), rabbit: i => hopper('rabbit', i),
  owl, penguin,
  axolotl, slime, dragon, wizard,
};
const TRAVEL_ART = Object.fromEntries(Object.entries(DRAW).flatMap(([name, draw]) =>
  Array.from({ length: name === 'slime' ? 24 : 8 }, (_, i) => [`${name}_travel${i}`, draw(i)])));
for (const name of ['owl', 'dragon']) {
  for (let i = 0; i < 8; i++) TRAVEL_ART[`${name}_flight${i}`] = TRAVEL_ART[`${name}_travel${i}`];
}
export { TRAVEL_ART };
