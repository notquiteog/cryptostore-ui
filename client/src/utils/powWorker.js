/**
 * The proof-of-work solver's own thread. See pow.js for the puzzle and for
 * why this is a file rather than a Blob, and powHash.js for the hash.
 *
 * The search runs in slices so a progress message goes out between them;
 * the slice is the unit of work between two messages, nothing more.
 */
import { searchCounter } from './powHash.js';

const SLICE = 4096;

self.onmessage = (e) => {
  const { nonce, bits } = e.data;
  for (let from = 0; ; from += SLICE) {
    const hit = searchCounter(nonce, bits, from, from + SLICE);
    if (hit != null) {
      self.postMessage({ counter: hit });
      return;
    }
    self.postMessage({ progress: from + SLICE });
  }
};
