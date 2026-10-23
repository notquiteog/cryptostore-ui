import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Expand, Package, Play } from 'lucide-react';
import MediaLightbox from './MediaLightbox';
import StageVideo from './StageVideo';

const VIDEO_RE = /\.(mp4|webm|mov|m4v)$/i;

export function isVideoPath(path, mediaType) {
  return mediaType === 'video' || VIDEO_RE.test(path || '');
}

/**
 * Product media viewer: one stage, a thumbnail rail and a lightbox.
 *
 * The stage deliberately does NOT magnify on hover. It used to scale the image
 * 2× under the cursor, which meant the photo lurched the moment the pointer
 * crossed it on the way to the thumbnails or the expand button, and there was
 * no way to look at the page with the mouse resting anywhere near the artwork.
 * Enlarging is the lightbox's job, where it is asked for rather than triggered.
 *
 * The stage owns the selected index rather than the page, because every way of
 * changing it — thumbnail, arrow button, arrow key, swipe, lightbox — has to
 * agree, and threading five handlers back through the page bought nothing. The
 * page only says which media list is current; picking a variant with its own
 * photos resets the stage to the first of them via the `media` identity check
 * below.
 */
export default function ProductGallery({ media = [], alt = '', oos = false, badges = null }) {
  const [index, setIndex] = useState(0);
  const [lightbox, setLightbox] = useState(false);
  const touchRef = useRef(null);

  const count = media.length;
  const current = media[Math.min(index, Math.max(0, count - 1))] || null;

  // A joined key, not the array itself: the page rebuilds this list on every
  // render, so an identity check on the array would reset the stage constantly
  // and a length check would miss a same-length swap between two variants.
  const mediaKey = useMemo(() => media.map(m => m.src).join('|'), [media]);
  useEffect(() => { setIndex(0); }, [mediaKey]);

  const step = useCallback((delta) => {
    if (count < 2) return;
    setIndex(i => (i + delta + count) % count);
  }, [count]);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // Horizontal intent only — a vertical drag is the page scrolling past.
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    step(dx < 0 ? 1 : -1);
  };

  const renderMedia = (item, className) => (
    item.isVideo
      ? (
        <StageVideo
          // Stood down while the lightbox is up. The overlay does not unmount
          // the stage and both share this component's index, so without this
          // the same clip plays twice the moment the lightbox lands on it.
          suspended={lightbox}
          /* Keyed per clip. Without it React reuses the one <video> element
             across a video → video thumbnail swap, and the second clip
             inherits the first one's position, mute state and loop flag. */
          key={item.src}
          src={item.src}
          poster={item.poster}
          className={className}
          label={alt}
        />
      )
      : <img src={item.poster || item.src} alt={alt} className={className} draggable={false} />
  );

  return (
    <div className="pd-gallery">
      <div
        className="pd-stage"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        }}
        tabIndex={count > 1 ? 0 : -1}
        role={count > 1 ? 'group' : undefined}
        aria-label={count > 1 ? `${alt} media, ${index + 1} of ${count}` : undefined}
      >
        <div className="pd-stage-glow" aria-hidden="true" />

        {current
          ? renderMedia(current, 'pd-media')
          : <div className="pd-media-empty"><Package size={64} aria-hidden="true" /></div>}

        {badges && <div className="pd-stage-badges">{badges}</div>}

        {oos && <div className="pd-oos-overlay"><span>Out of stock</span></div>}

        {/* Video too, which it did not used to be. The stage's own player has
            no fullscreen of its own — that was the whole point of replacing the
            browser's chrome — so without this the only way to see a clip full
            size was to open the lightbox on a photo and arrow across to it. */}
        {current && (
          <button
            type="button"
            className="pd-stage-expand"
            onClick={() => setLightbox(true)}
            aria-label={current.isVideo ? 'View video full size' : 'View full size'}
            title={current.isVideo ? 'View video full size' : 'View full size'}
          >
            <Expand size={15} aria-hidden="true" />
          </button>
        )}

        {count > 1 && (
          <>
            <button type="button" className="pd-nav prev" onClick={() => step(-1)} aria-label="Previous image">
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button type="button" className="pd-nav next" onClick={() => step(1)} aria-label="Next image">
              <ChevronRight size={18} aria-hidden="true" />
            </button>
            <span className="pd-counter" aria-hidden="true">{index + 1} / {count}</span>
          </>
        )}
      </div>

      {count > 1 && (
        <div className="pd-thumbs" role="tablist" aria-label="Product media">
          {media.map((m, i) => (
            <button
              key={`${m.src}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Show ${m.isVideo ? 'video' : 'image'} ${i + 1}`}
              className={`pd-thumb${i === index ? ' active' : ''}`}
              onClick={() => setIndex(i)}
            >
              {m.isVideo
                ? (
                  <>
                    {/* The poster frame when there is one: a thumbnail rail
                        that has to fetch metadata for every clip just to paint
                        a first frame is slow and, on a cold cache, blank. */}
                    {m.poster
                      ? <img src={m.poster} alt="" draggable={false} />
                      : <video src={m.src} muted playsInline preload="metadata" />}
                    <span className="pd-thumb-play"><Play size={12} aria-hidden="true" /></span>
                  </>
                )
                : <img src={m.poster || m.src} alt="" draggable={false} />}
            </button>
          ))}
        </div>
      )}

      {lightbox && current && (
        <MediaLightbox
          items={media}
          index={index}
          onIndex={setIndex}
          onClose={() => setLightbox(false)}
          label={`${alt} — full size`}
        />
      )}
    </div>
  );
}
