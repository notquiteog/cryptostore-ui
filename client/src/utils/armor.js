/**
 * The structural check on a pasted PGP block — the client twin of
 * server/utils/armor.js, kept in step by hand and by client/test/armor.test.mjs,
 * which runs one fixture set through both and fails if they ever disagree.
 *
 * Why the client runs it at all: the server is the authority and refuses the
 * order, but a buyer who has just spent a minute encrypting an address in
 * another window deserves to hear "there is text below the END line" while the
 * textarea is still in front of them, not as a 400 after pressing Place order.
 * The client cannot inspect packets (that needs openpgp, which is a server
 * dependency); the shape is the half it can check, and the server re-checks
 * both halves regardless of what this said.
 */

const BEGIN_MESSAGE = '-----BEGIN PGP MESSAGE-----';
const END_MESSAGE = '-----END PGP MESSAGE-----';
const BEGIN_PUBLIC_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----';
const END_PUBLIC_KEY = '-----END PGP PUBLIC KEY BLOCK-----';
const ANY_ARMOR_RE = /-{5}BEGIN PGP [A-Z ]+-{5}/;

/**
 * The armor checksum, verified here because openpgp v6 does not verify it.
 *
 * OpenPGP armor ends with an optional `=XXXX` line: a base64 CRC-24 over the
 * decoded body. The current spec (RFC 9580) made it optional and openpgp.js
 * ignores it entirely, so a block whose body was mangled in the paste — a
 * line pasted twice, characters reflowed by a chat client — parses cleanly as
 * long as the packet framing survives, and the store stores ciphertext nobody
 * will ever decrypt. When the line IS present (every GnuPG and openpgp.js
 * block carries one), checking it costs a few hundred bytes of arithmetic and
 * catches the paste before the order exists.
 */
const CRC24_INIT = 0xb704ce;
const CRC24_POLY = 0x1864cfb;

function crc24(bytes) {
  let crc = CRC24_INIT;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 16;
    for (let b = 0; b < 8; b++) {
      crc <<= 1;
      if (crc & 0x1000000) crc ^= CRC24_POLY;
    }
  }
  return crc & 0xffffff;
}

/**
 * Base64 to bytes without Buffer or atob, so this file and its client twin can
 * be byte-for-byte the same function. Returns null on a malformed string.
 */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeBase64(str) {
  const clean = str.replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(clean)) return null;
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    buffer = (buffer << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/** The `=XXXX` line's value, if the block carries one, else null. */
function crcLineValue(line) {
  const m = /^=([A-Za-z0-9+/]{4})$/.exec(line);
  if (!m) return null;
  const bytes = decodeBase64(m[1]);
  if (!bytes || bytes.length < 3) return null;
  return (bytes[0] << 16) | (bytes[1] << 8) | bytes[2];
}

export function mentionsArmor(text) {
  return ANY_ARMOR_RE.test(String(text || ''));
}

export function checkArmorShape(text) {
  const raw = String(text || '').replace(/\r\n?/g, '\n');
  const trimmed = raw.trim();
  const lines = trimmed.split('\n');
  const first = lines[0].trim();
  const last = lines[lines.length - 1].trim();

  const beginAt = trimmed.indexOf(BEGIN_MESSAGE);
  const endAt = trimmed.lastIndexOf(END_MESSAGE);

  if (beginAt === -1) {
    const kind = /BEGIN PGP (PUBLIC|PRIVATE) KEY BLOCK/.test(trimmed) ? 'a PGP key'
      : /BEGIN PGP SIGNED MESSAGE/.test(trimmed) ? 'a signed message, which is readable text'
        : /BEGIN PGP SIGNATURE/.test(trimmed) ? 'a detached signature'
          : 'not a PGP message';
    return {
      ok: false,
      code: 'not_message',
      message: `That is ${kind} — not an encrypted message. Encrypt your address to the store key and paste the PGP MESSAGE block.`,
    };
  }
  if (endAt === -1 || endAt < beginAt) {
    return {
      ok: false,
      code: 'no_end',
      message: 'The block is missing its END PGP MESSAGE line — it was cut off in the paste. Copy the whole block again.',
    };
  }
  if (first !== BEGIN_MESSAGE || beginAt !== 0) {
    return {
      ok: false,
      code: 'text_before',
      message: 'There is text above the BEGIN PGP MESSAGE line. Paste only the encrypted block — anything outside it is stored readable.',
    };
  }
  if (last !== END_MESSAGE || endAt + END_MESSAGE.length !== trimmed.length) {
    return {
      ok: false,
      code: 'text_after',
      message: 'There is text below the END PGP MESSAGE line. Paste only the encrypted block — anything outside it is stored readable.',
    };
  }
  const body = lines.slice(1, -1).map((l) => l.trim()).filter(Boolean);
  const payload = body.filter((l) => !/^[A-Za-z-]+:\s/.test(l));
  if (payload.length === 0 || !payload.some((l) => /^[A-Za-z0-9+/=]{4,}$/.test(l))) {
    return {
      ok: false,
      code: 'empty_body',
      message: 'The block has no encrypted body between its BEGIN and END lines.',
    };
  }

  // The checksum, when the block carries one. The CRC line is the last
  // payload line and starts with `=`; base64 data never does.
  const lastLine = payload[payload.length - 1];
  const expected = crcLineValue(lastLine);
  if (expected !== null) {
    const bytes = decodeBase64(payload.slice(0, -1).join(''));
    if (bytes === null) {
      return {
        ok: false,
        code: 'bad_base64',
        message: 'The block contains characters that are not part of a PGP message — it was altered in the paste. Copy it again from your PGP client.',
      };
    }
    if (crc24(bytes) !== expected) {
      return {
        ok: false,
        code: 'bad_crc',
        message: 'The block fails its own checksum — a line was lost or changed in the paste. Copy it again from your PGP client.',
      };
    }
  }
  return { ok: true };
}

/**
 * The structural check on a pasted PUBLIC KEY block.
 *
 * ── The failure this exists to catch ────────────────────────────────────────
 *
 * A private key pasted into a public-key box. Every field in this app that
 * takes a key says "public key" beside it and says the store never asks for a
 * private one — and none of that stops somebody with two blocks in their
 * clipboard history from pasting the wrong one into a textarea and pressing
 * save.
 *
 * `pgpService.validatePublicKey` refuses it on the server and is the
 * authority. But by the time it does, the secret key has been typed into a
 * page, posted over the network, and written into whatever the browser
 * remembers of form state — so a check that only lives there is a check that
 * arrives after the damage.
 *
 * This one is caught HERE, before the value can leave the tab, and the message
 * says what to do about it rather than only that it was refused. It is the one
 * check in this file whose entire value is in not making the request.
 *
 * The rest is shape only. Whether the block is a key openpgp can actually read
 * is the server's answer (`pgpService.validatePublicKey`), and it is asked on
 * every path regardless of what this returned.
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
export function checkPublicKeyBlock(text) {
  const trimmed = String(text || '').replace(/\r\n?/g, '\n').trim();

  if (!trimmed) {
    return { ok: false, code: 'empty', message: 'Paste your public key block.' };
  }

  // Checked before the "is it a public key" test, so the private-key paste
  // gets its own answer rather than a generic "that is not a public key".
  if (/-{5}BEGIN PGP PRIVATE KEY BLOCK-{5}/.test(trimmed)) {
    return {
      ok: false,
      code: 'private_key',
      message: 'That is your PRIVATE key. Nothing here ever needs it — clear the box, and paste the block that says PUBLIC instead.',
    };
  }

  const beginAt = trimmed.indexOf(BEGIN_PUBLIC_KEY);
  const endAt = trimmed.lastIndexOf(END_PUBLIC_KEY);

  if (beginAt === -1) {
    const kind = /-{5}BEGIN PGP MESSAGE-{5}/.test(trimmed) ? 'an encrypted message'
      : /-{5}BEGIN PGP SIGNATURE-{5}/.test(trimmed) ? 'a detached signature'
        : /-{5}BEGIN PGP SIGNED MESSAGE-{5}/.test(trimmed) ? 'a signed message'
          : 'not a PGP block';
    return {
      ok: false,
      code: 'not_public_key',
      message: `That is ${kind}. Export your public key and paste the whole block, from BEGIN PGP PUBLIC KEY BLOCK to END.`,
    };
  }
  if (endAt === -1 || endAt < beginAt) {
    return {
      ok: false,
      code: 'no_end',
      message: 'The block is missing its END PGP PUBLIC KEY BLOCK line — it was cut off in the paste. Copy the whole block again.',
    };
  }

  // Only the block, and nothing around it. A key column that quietly stored a
  // covering note would hand every later reader a value that is not a key.
  const block = trimmed.slice(beginAt, endAt + END_PUBLIC_KEY.length);
  if (block !== trimmed) {
    return {
      ok: false,
      code: 'text_around',
      message: 'There is text outside the block. Paste only the key, from the BEGIN line to the END line.',
    };
  }

  const body = block.split('\n').slice(1, -1).map((l) => l.trim()).filter(Boolean);
  const payload = body.filter((l) => !/^[A-Za-z-]+:\s/.test(l));
  if (!payload.some((l) => /^[A-Za-z0-9+/=]{4,}$/.test(l))) {
    return {
      ok: false,
      code: 'empty_body',
      message: 'The block has no key data between its BEGIN and END lines.',
    };
  }

  return { ok: true };
}

export { crc24, decodeBase64 };
