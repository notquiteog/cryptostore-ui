/**
 * Turning authored copy into something safe to print.
 *
 * Product descriptions in this catalog were authored with light HTML — `<br>`
 * between lines, the occasional `<b>` — and the server stores them that way
 * (`productController` runs them through `xss()`, which keeps `<br>`). React
 * escapes text nodes, so printing the string raw shows the tags: the product
 * page rendered "Raw Garden 1:1 CBD/THC <br>" on screen, tag and all.
 *
 * The other direction is worse. Rendering the string as HTML would hand page
 * markup to whoever writes product copy, and this codebase has exactly one
 * rule about that (see `utils/microMarkdown.jsx`): there is no
 * `dangerouslySetInnerHTML` anywhere, so there is no surface for authored text
 * to become script on. Flattening to text keeps that property — everything
 * that comes out of here is still an ordinary React text node.
 *
 * This lived as a private function inside `pages/Home.jsx`, which meant the
 * home carousel was the only surface that knew descriptions needed
 * flattening, and the product page — where the same text is printed at four
 * times the size — did not. That is this repository's named failure mode, and
 * it does not stop at the server boundary. One module, every caller.
 */

const ENTITIES = {
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&amp;': '&',
};

const decodeEntities = (s) =>
  s.replace(/&nbsp;|&lt;|&gt;|&quot;|&#39;|&amp;/gi, m => ENTITIES[m.toLowerCase()] ?? m);

/**
 * One line, no tags — for a card teaser or a rail caption, where the copy has
 * two lines of room and every break would be spent on whitespace.
 */
export function plainText(value) {
  if (value == null) return '';
  return decodeEntities(
    String(value)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
      .replace(/<[^>]*>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The same text with its breaks kept, for somewhere with room to print them —
 * the product page's description, whose container is `white-space: pre-line`.
 *
 * Runs of three or more blank lines collapse to one gap: copy pasted out of a
 * word processor arrives with a dozen, and a description that scrolls past its
 * own paragraphs is not the author's intent.
 */
export function plainLines(value) {
  if (value == null) return '';
  return decodeEntities(
    String(value)
      // Line endings first. These descriptions are stored as "…THC <br>\r\n1G
      // Vape Cart" — a tag AND a real newline for the same single break — so
      // normalising afterwards turned one break into a blank line. Each <br>
      // swallows the whitespace that follows it for the same reason.
      .replace(/\r\n?/g, '\n')
      .replace(/<br\s*\/?>[ \t]*\n?/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>[ \t]*\n?/gi, '\n')
      .replace(/<[^>]*>/g, ''),
  )
    // Trailing spaces before a newline show up as ragged indentation once the
    // container honours whitespace.
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
