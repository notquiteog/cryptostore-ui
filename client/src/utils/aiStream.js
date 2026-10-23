/**
 * Read an NDJSON event stream from one of the AI routes.
 *
 * ── One reader, because the framing has three ways to go wrong ─────────────
 *
 * `Buddy` grew its own copy of this loop for `/ai/ask`, and the staff tools
 * now need the same thing for seven more routes. Written per caller, the same
 * three bugs appear each time:
 *
 *  1. **Chunk boundaries.** A `read()` does not return whole lines. A parser
 *     that JSON-parses each chunk works perfectly until an event straddles a
 *     network packet, which is to say it works on localhost and fails on Tor.
 *     The buffer has to be carried between reads.
 *  2. **The last line.** A stream can end without a trailing newline, so the
 *     final event is sitting in the buffer when `done` arrives. Dropping it
 *     loses exactly the `result` event the whole request was for.
 *  3. **Errors after the headers.** Once the first token is written the status
 *     code is already sent, so a failure arrives as an `{type:'error'}` event
 *     rather than a non-2xx response. A reader that only checks `res.ok`
 *     treats a failed generation as an empty successful one.
 *
 * So: one loop, and callers get events.
 *
 * @param {Response} res  a fetch Response whose body is NDJSON
 * @yields {object} one parsed event per line
 */
export async function* readNdjson(res) {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        // A line that will not parse is skipped rather than thrown on. The
        // alternative is that one malformed event — a proxy that injected
        // something, a truncated write — discards an answer that was otherwise
        // complete.
        try { yield JSON.parse(line); } catch { /* not an event; ignore */ }
      }
    }
    // See (2) above: whatever is left when the stream ends is an event too.
    const tail = buffer.trim();
    if (tail) {
      try { yield JSON.parse(tail); } catch { /* ignore */ }
    }
  } finally {
    // Releasing matters on the abort path: an un-released reader keeps the
    // connection out of the browser's pool until it is garbage collected.
    reader.releaseLock?.();
  }
}
