import { useMemo } from 'react';
import { encode } from '../utils/code128';

/**
 * A Code 128 barcode as SVG rects.
 *
 * SVG rather than the gradient trick because print is where a barcode earns
 * its keep, and a `<rect>` grid scales to any label size with crisp edges
 * while a background gradient is rasterised at screen resolution. The
 * `viewBox` is in modules, so the same element can be 40mm on a thermal
 * label and 120px on screen.
 *
 * The text is printed beneath by the CALLER, not here: every sheet that
 * carries a code already has its own typography for the reference, and a
 * human-readable line under the bars is what makes the code useful when the
 * scanner is out of batteries.
 *
 * `role="img"` with the value as its label, so a screen reader hears the code
 * rather than an unexplained graphic — the old decorative bars were hidden
 * from assistive tech precisely because they said nothing; these say the
 * reference.
 */
export default function Barcode({ value, height = 44, className = '', title }) {
  const code = useMemo(() => {
    try { return encode(value); } catch { return null; }
  }, [value]);
  if (!code) return null;

  const rects = [];
  let x = 0;
  code.widths.forEach((w, i) => {
    if (i % 2 === 1) rects.push(<rect key={i} x={x} y="0" width={w} height="1" />);
    x += w;
  });

  return (
    <svg
      className={`barcode ${className}`.trim()}
      viewBox={`0 0 ${code.total} 1`}
      preserveAspectRatio="none"
      height={height}
      width="100%"
      role="img"
      aria-label={title || `Barcode ${value}`}
      shapeRendering="crispEdges"
      fill="currentColor"
    >
      {rects}
    </svg>
  );
}
