/**
 * Writing shelf locations, in the batches the server will actually accept.
 *
 * ── The bug this exists for ─────────────────────────────────────────────────
 *
 * `PUT /fulfilment/bins` refuses more than 500 rows in one request
 * (`setBinLocations` in server/controllers/fulfilmentController.js), and both
 * pages that file shelves — the Shelves grid and the warehouse map's slot
 * editor — sent every staged row in a single call. On a catalogue of any size
 * that is not a limit an operator ever reaches by hand, and it is exactly what
 * the page's own "select all" reaches in one click: selecting the shelf page's
 * header checkbox on a 12,798-variant catalogue, typing a shelf and pressing
 * Apply staged 12,798 changes, and Save answered "Assign at most 500 locations
 * in one request." Nothing was written, the draft stayed staged, and the
 * message named a limit that appears nowhere on the page.
 *
 * So the write is chunked here instead, and this module is the one both pages
 * use — a chunk size living in two files is a chunk size that disagrees with
 * itself the first time the server's cap moves.
 *
 * ── Why it reports a partial write rather than rolling back ─────────────────
 *
 * Each chunk is its own transaction on the server and there is no way to undo
 * an accepted one from here. Pretending otherwise would be worse than saying
 * what happened: if chunk four is refused, chunks one to three are on the
 * shelves and the rows they carried are no longer staged, while everything
 * from chunk four on is still staged and still on screen. `saved` and
 * `remaining` are what the caller tells the operator, so the number on the
 * Save button after a failure is the number of rows still to write.
 */

/**
 * The server's cap, mirrored. Keep in step with `setBinLocations` in
 * server/controllers/fulfilmentController.js — nothing checks that they agree,
 * and a client that guesses higher gets a wholesale refusal instead of a
 * write.
 */
export const BIN_CHUNK = 500;

/**
 * Write `rows` ({ variant_id, bin_location }) through `put`, in chunks.
 *
 * @param {Array} rows
 * @param {(body: object) => Promise<object>} put  usually `(body) => api.put('/fulfilment/bins', body)`
 * @param {{ onProgress?: (saved: number, total: number) => void, chunk?: number }} opts
 * @returns {Promise<{changed: number, chunks: number, remaining: Array, error: Error|null}>}
 */
export async function writeBins(rows, put, { onProgress, chunk = BIN_CHUNK } = {}) {
  const all = Array.isArray(rows) ? rows : [];
  let changed = 0;
  let chunks = 0;
  for (let i = 0; i < all.length; i += chunk) {
    const slice = all.slice(i, i + chunk);
    try {
      const res = await put({ bins: slice });
      // `changed` is the server's count of rows it actually moved, which is not
      // the number sent: a row already sitting on that shelf changes nothing.
      changed += Number(res?.changed ?? slice.length) || 0;
      chunks += 1;
      onProgress?.(i + slice.length, all.length);
    } catch (error) {
      return { changed, chunks, remaining: all.slice(i), error };
    }
  }
  return { changed, chunks, remaining: [], error: null };
}
