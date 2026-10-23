/**
 * Find the armored PGP MESSAGE blocks inside free text.
 *
 * Customers paste encrypted blocks into places that are not the address
 * field: a support ticket ("here is my address again"), a dispute reply, an
 * order note, the live chat. Each of those renders text, and text that
 * happens to contain forty lines of base64 is unreadable as text — while a
 * staff member holding the decrypt grant has no way to open it short of
 * copying it to the PGP page. This splits such text into its prose and its
 * blocks so the page can draw each block as the panel the order page already
 * draws for an encrypted address, decrypt button included.
 *
 * Only PGP MESSAGE blocks: a public key or a signed message pasted into a
 * ticket is readable as it stands, and a "decrypt" button on either would be
 * a button that always fails. Dependency-free and node-testable
 * (client/test/pgpBlocks.test.mjs); the header match is the same literal the
 * server's armor check keys on.
 */

const BLOCK_RE = /-{5}BEGIN PGP MESSAGE-{5}[\s\S]*?-{5}END PGP MESSAGE-{5}/g;

/** Does this text carry at least one complete PGP MESSAGE block? */
export function hasMessageBlock(text) {
  BLOCK_RE.lastIndex = 0;
  return BLOCK_RE.test(String(text || ''));
}

/**
 * @returns {Array<{ type: 'text'|'block', value: string }>} in document
 *   order; empty prose between blocks is dropped, prose is trimmed of the
 *   blank lines that framed a block. A text with no block is one text
 *   segment, untouched.
 */
export function splitMessageBlocks(text) {
  const s = String(text || '');
  const out = [];
  let last = 0;
  BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = BLOCK_RE.exec(s)) !== null) {
    const before = s.slice(last, m.index).replace(/^\s*\n|\n\s*$/g, '');
    if (before.trim()) out.push({ type: 'text', value: before });
    out.push({ type: 'block', value: m[0] });
    last = m.index + m[0].length;
  }
  if (out.length === 0) return [{ type: 'text', value: s }];
  const after = s.slice(last).replace(/^\s*\n|\n\s*$/g, '');
  if (after.trim()) out.push({ type: 'text', value: after });
  return out;
}
