import { useState } from 'react';

export default function StarRating({ rating = 0, interactive = false, onRate, size = 18 }) {
  const [hovered, setHovered] = useState(0);
  const display = interactive ? (hovered || rating) : rating;

  return (
    <span style={{ display: 'inline-flex', gap: 2, cursor: interactive ? 'pointer' : 'default', lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span
          key={n}
          /* An empty star is a glyph, not an edge. `--border` is a hairline
             token — rgba(15,23,42,0.13) in light — which composites to 1.31:1
             on a card, so the unfilled stars simply vanished and a 2-star
             rating read as two stars floating in a gap. `--text-muted` is
             solved to 4.5:1 against the ground in both modes. */
          style={{ fontSize: size, color: n <= display ? 'var(--warning)' : 'var(--text-muted)', lineHeight: 1 }}
          onMouseEnter={interactive ? () => setHovered(n) : undefined}
          onMouseLeave={interactive ? () => setHovered(0) : undefined}
          onClick={interactive && onRate ? () => onRate(n) : undefined}
        >
          {n <= display ? '★' : '☆'}
        </span>
      ))}
    </span>
  );
}
