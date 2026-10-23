import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Film, X } from 'lucide-react';
import toast from 'react-hot-toast';

export const MAX_REVIEW_FILES = 4;
const MAX_BYTES = 60 * 1024 * 1024;
// Same list as admin/MediaSlots — kept in step with the server whitelist so an
// iPhone buyer's raw `.mov`/`.heic` is offered by the picker instead of dying
// on the server gate.
const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,image/heic,image/heif,image/avif,image/tiff,video/x-matroska,video/x-msvideo';

/**
 * Picks the files that will be attached to a review, and previews them locally.
 *
 * Nothing is uploaded from here. The review has to exist before media can hang
 * off it, so the parent posts the review first and then sends this list — which
 * also means a failed upload leaves a posted review rather than losing the text
 * the buyer wrote.
 *
 * Previews are object URLs over the *original* file, so they are the only place
 * in the app that ever renders un-processed upload bytes. That is fine — they
 * never leave the browser, and they are revoked on unmount. What the store
 * publishes is the re-encoded copy the server builds.
 */
export default function ReviewMediaPicker({ files, onChange, disabled }) {
  const [previews, setPreviews] = useState([]);
  const inputRef = useRef(null);

  useEffect(() => {
    const urls = files.map(f => ({
      url: URL.createObjectURL(f),
      isVideo: f.type.startsWith('video/'),
      name: f.name,
    }));
    setPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u.url));
  }, [files]);

  const add = (incoming) => {
    const picked = Array.from(incoming || []);
    if (picked.length === 0) return;

    const room = MAX_REVIEW_FILES - files.length;
    if (room <= 0) return toast.error(`You can attach up to ${MAX_REVIEW_FILES} files`);

    const tooBig = picked.filter(f => f.size > MAX_BYTES);
    if (tooBig.length) {
      toast.error(`"${tooBig[0].name}" is over 60 MB`);
    }
    const usable = picked.filter(f => f.size <= MAX_BYTES).slice(0, room);
    if (picked.length - tooBig.length > room) {
      toast.error(`Only ${room} more ${room === 1 ? 'file fits' : 'files fit'} on this review`);
    }
    if (usable.length) onChange([...files, ...usable]);
  };

  const removeAt = (i) => onChange(files.filter((_, idx) => idx !== i));

  return (
    <div className="pd-media-picker">
      <div className="pd-media-picker-head">
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || files.length >= MAX_REVIEW_FILES}
        >
          <ImagePlus size={14} aria-hidden="true" />
          Add photos or video
        </button>
        <span className="pd-hint" style={{ margin: 0 }}>
          Up to {MAX_REVIEW_FILES} files · clips are trimmed to 30s · location and
          device data is stripped and everything is re-encoded before it is published
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => { add(e.target.files); e.target.value = ''; }}
      />

      {previews.length > 0 && (
        <ul className="pd-media-strip">
          {previews.map((p, i) => (
            <li key={`${p.name}-${i}`} className="pd-media-chip">
              {p.isVideo
                ? <><video src={p.url} muted playsInline /><span className="pd-media-chip-badge"><Film size={11} aria-hidden="true" /></span></>
                : <img src={p.url} alt="" />}
              <button
                type="button"
                className="pd-media-chip-x"
                onClick={() => removeAt(i)}
                disabled={disabled}
                aria-label={`Remove ${p.name}`}
              >
                <X size={11} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
