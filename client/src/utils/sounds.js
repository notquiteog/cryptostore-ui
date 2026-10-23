/**
 * UI sounds, synthesized locally with WebAudio.
 *
 * No audio files and no dependency, on purpose: a vendored mp3 is more bytes
 * on every install and another asset to audit, while four oscillators are
 * free, identical everywhere, and cannot 404 on a filtered network. Volumes
 * sit low — these are confirmations, not announcements.
 *
 * Muting is PER DEVICE via localStorage, not a server setting: sound taste
 * is personal and per-machine (a phone in public vs a desk), it must work
 * for guests, and writing a preference row for it would be data the server
 * has no need to hold.
 *
 * Autoplay policy: browsers keep an AudioContext suspended until a user
 * gesture. Every sound here follows a click except `notify`, so on the rare
 * notify-before-first-gesture the context stays suspended and the sound is
 * skipped SILENTLY — a decorative chime must never produce a console of
 * autoplay warnings, and definitely never a retry loop.
 */

const MUTE_KEY = 'cs.sounds.v1';

export function soundsMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === 'off';
  } catch {
    return false;
  }
}

export function setSoundsMuted(muted) {
  try {
    if (muted) localStorage.setItem(MUTE_KEY, 'off');
    else localStorage.removeItem(MUTE_KEY);
  } catch { /* private mode: sounds simply stay on */ }
}

let ctx = null;

function context() {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** One enveloped oscillator note. Times are relative to `at` (ctx seconds). */
function note(ac, dest, { type = 'sine', freq, to, at = 0, dur = 0.15, peak = 0.12 }) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  const t0 = ac.currentTime + at;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  // Attack fast, decay exponentially — the click-free envelope.
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

const SOUNDS = {
  /** A soft pop — something small landed where it was put (add to cart). */
  cart(ac, out) {
    note(ac, out, { freq: 520, to: 700, dur: 0.09, peak: 0.11 });
  },
  /** Two-tone chime — something arrived for you (message, update). */
  notify(ac, out) {
    note(ac, out, { freq: 659, dur: 0.16, peak: 0.09 });
    note(ac, out, { freq: 880, at: 0.11, dur: 0.24, peak: 0.09 });
  },
  /** Rising triad — money landed, the good one (payment confirmed). */
  success(ac, out) {
    note(ac, out, { freq: 523.25, at: 0, dur: 0.14, peak: 0.09 });
    note(ac, out, { freq: 659.25, at: 0.09, dur: 0.14, peak: 0.09 });
    note(ac, out, { freq: 783.99, at: 0.18, dur: 0.16, peak: 0.09 });
    note(ac, out, { freq: 1046.5, at: 0.27, dur: 0.3, peak: 0.1 });
  },
  /** A low, short buzz — that didn't work. */
  error(ac, out) {
    note(ac, out, { type: 'sawtooth', freq: 190, to: 150, dur: 0.18, peak: 0.06 });
  },
  /** A dry tick for small state flips. */
  tick(ac, out) {
    note(ac, out, { type: 'triangle', freq: 1900, dur: 0.035, peak: 0.05 });
  },
};

/**
 * Play a named sound. Always safe to call: muted, unsupported, suspended
 * (no gesture yet) and unknown names are all silent no-ops.
 */
export function playSound(name) {
  if (soundsMuted()) return;
  const make = SOUNDS[name];
  const ac = make ? context() : null;
  if (!ac) return;
  if (ac.state === 'suspended') {
    // resume() only succeeds after a user gesture; when it doesn't, skip.
    ac.resume().then(() => { if (ac.state === 'running') make(ac, ac.destination); }).catch(() => {});
    return;
  }
  make(ac, ac.destination);
}
