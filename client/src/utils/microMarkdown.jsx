/**
 * A deliberately small markdown renderer that builds React elements directly.
 *
 * No dependency and — more importantly — NO HTML PATH AT ALL: there is no
 * dangerouslySetInnerHTML anywhere in here, every piece of author text lands
 * as a React text node, and React escapes those natively. A malicious page
 * body cannot become script because there is no surface for it to become
 * script on. This is why the store's pages are markdown-only: a sanitiser in
 * front of raw HTML is a bet that the sanitiser is perfect, and this design
 * simply doesn't take the bet.
 *
 * Supported, and nothing more: # to #### headings, paragraphs, **bold**,
 * *italic*, `code`, [text](url), unordered/ordered lists, > blockquotes,
 * fenced code blocks, and --- rules. The subset is a feature — an operator's
 * legal page needs structure, not an embedded application.
 *
 * Links: http(s), mailto, and site-relative paths only. javascript: and
 * data: (and anything else clever) render as plain text instead of a link —
 * visibly inert rather than silently stripped, so the author notices.
 */

const SAFE_HREF = /^(https?:\/\/|mailto:|\/(?!\/))/i;

/** Inline pass: bold, italic, code, links. Returns an array of React nodes. */
function renderInline(text, keyBase) {
  const nodes = [];
  let rest = text;
  let k = 0;
  // One combined regex, earliest match wins — running passes sequentially
  // instead broke on "**a `b` c**", where the code pass split the bold pair.
  const token = /(\*\*(.+?)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))/;
  while (rest) {
    const m = token.exec(rest);
    if (!m) {
      nodes.push(rest);
      break;
    }
    if (m.index > 0) nodes.push(rest.slice(0, m.index));
    const key = `${keyBase}-${k++}`;
    if (m[1]) {
      nodes.push(<strong key={key}>{renderInline(m[2], key)}</strong>);
    } else if (m[3]) {
      nodes.push(<em key={key}>{renderInline(m[4], key)}</em>);
    } else if (m[5]) {
      nodes.push(<code key={key}>{m[6]}</code>);
    } else if (m[7]) {
      const href = m[9];
      if (SAFE_HREF.test(href)) {
        const external = /^https?:/i.test(href);
        nodes.push(
          <a
            key={key}
            href={href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {renderInline(m[8], key)}
          </a>,
        );
      } else {
        // Unsafe scheme: the text stays, the link does not.
        nodes.push(m[8]);
      }
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return nodes;
}

/**
 * Block pass. Line-oriented, no backtracking, no state machine beyond the
 * current list/quote/fence being accumulated.
 */
export default function MicroMarkdown({ source, className }) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  let key = 0;

  const flushList = (items, ordered) => {
    const Tag = ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`b${key++}`}>
        {items.map((item, j) => <li key={j}>{renderInline(item, `l${key}-${j}`)}</li>)}
      </Tag>,
    );
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    // Fenced code block — verbatim until the closing fence (or EOF).
    if (/^```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1; // past the closing fence
      blocks.push(<pre key={`b${key++}`}><code>{buf.join('\n')}</code></pre>);
      continue;
    }

    if (/^(---|\*\*\*|___)\s*$/.test(line)) {
      blocks.push(<hr key={`b${key++}`} />);
      i += 1;
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = `h${heading[1].length + 1}`; // # renders as h2: the page title owns h1
      blocks.push(<Tag key={`b${key++}`}>{renderInline(heading[2], `h${key}`)}</Tag>);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push(
        <blockquote key={`b${key++}`}>
          {renderInline(buf.join(' '), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, ''));
        i += 1;
      }
      flushList(items, false);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ''));
        i += 1;
      }
      flushList(items, true);
      continue;
    }

    // Paragraph: consecutive plain lines join with spaces.
    const buf = [line];
    i += 1;
    while (
      i < lines.length && lines[i].trim()
      && !/^(#{1,4}\s|>|[-*]\s|\d+\.\s|```|---|\*\*\*|___)/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i += 1;
    }
    blocks.push(<p key={`b${key++}`}>{renderInline(buf.join(' '), `p${key}`)}</p>);
  }

  return <div className={className}>{blocks}</div>;
}
