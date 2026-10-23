import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

/**
 * Full-screen media viewer, shared by the product gallery and review media.
 *
 * One implementation rather than two, because the fiddly parts are the same
 * either way and are the parts that get forgotten: Escape to dismiss, arrows to
 * move, a scroll lock that restores the value it found rather than assuming the
 * page was scrollable, and a click on the artwork that does not dismiss the
 * sheet the click was meant to inspect.
 *
 * `items` are `{ src, isVideo, poster }`. The caller owns the index, so the
 * thumbnail strip behind the overlay stays in step with it.
 *
 * Rendered through a portal onto `document.body`, which is load-bearing rather
 * than tidiness. `position: fixed` and `z-index: 400` only rank this overlay
 * against its own stacking context, and both callers sit inside one: the
 * product gallery lives in `.pd-media-col`, which is `position: sticky` — and
 * sticky *always* creates a stacking context, whatever its z-index. So the
 * overlay was ranked among the gallery's own children, while `.pd-info-col`
 * next door painted later in DOM order and put the variant picker and the buy
 * box straight through the "full size" view. Portalling to the body makes the
 * z-index mean what it says.
 */
export default function MediaLightbox({ items = [], index = 0, onIndex, onClose, label = 'Media' }) {
  const count = items.length;
  const current = items[index];
  const videoRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && count > 1) onIndex((index + 1) % count);
      else if (e.key === 'ArrowLeft' && count > 1) onIndex((index - 1 + count) % count);
    };
    window.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [index, count, onIndex, onClose]);

  /*
   * Start the clip, with sound if the browser will grant it.
   *
   * This was a bare `autoPlay` attribute with no `muted`, which is a request
   * every engine is entitled to refuse: Chrome grants unmuted autoplay only
   * once the visitor has interacted with the origin or the site has crossed its
   * media-engagement threshold, and mobile Safari and Chrome essentially never
   * grant it at all. The refusal is *silent* — an attribute has no promise to
   * reject — so the viewer opened on a paused first frame and the buyer had to
   * press play on something they had just deliberately opened.
   *
   * Muted playback is the one thing always allowed, so a refusal falls back to
   * it rather than to nothing. The native controls are present here, so anyone
   * who wants the sound has an unmute under the cursor — which is precisely the
   * affordance the product stage has to build by hand, since it has no controls
   * to fall back on. Autoplay is owned here rather than by the attribute so
   * there is one decision and it can see whether it was honoured.
   */
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = false;
    const started = el.play();
    if (!started?.catch) return;
    started.catch(() => {
      el.muted = true;
      el.play().catch(() => {});
    });
  }, [current?.src]);

  if (!current) return null;

  return createPortal(
    <div className="pd-lightbox" role="dialog" aria-modal="true" aria-label={label} onClick={onClose}>
      <button type="button" className="pd-lightbox-close" aria-label="Close" onClick={onClose}>
        <X size={20} aria-hidden="true" />
      </button>

      {count > 1 && (
        <>
          <button
            type="button"
            className="pd-nav prev"
            aria-label="Previous"
            onClick={(e) => { e.stopPropagation(); onIndex((index - 1 + count) % count); }}
          >
            <ChevronLeft size={22} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pd-nav next"
            aria-label="Next"
            onClick={(e) => { e.stopPropagation(); onIndex((index + 1) % count); }}
          >
            <ChevronRight size={22} aria-hidden="true" />
          </button>
        </>
      )}

      <div className="pd-lightbox-frame" onClick={(e) => e.stopPropagation()}>
        {current.isVideo
          ? (
            <video
              /* Keyed per clip so arrowing from one video to the next resets
                 the element rather than handing the second clip the first
                 one's position and mute state. */
              key={current.src}
              ref={videoRef}
              src={current.src}
              poster={current.poster || undefined}
              controls
              playsInline
              className="pd-lightbox-media"
            />
          )
          : <img src={current.src} alt="" className="pd-lightbox-media" />}
      </div>

      {count > 1 && <span className="pd-counter lightbox" aria-hidden="true">{index + 1} / {count}</span>}
    </div>,
    document.body,
  );
}
