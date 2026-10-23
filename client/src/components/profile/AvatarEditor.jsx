import { useState, useRef } from 'react';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import { Camera, Trash2, Upload, Lock } from 'lucide-react';
import { AvatarImage } from '../Avatar';

/**
 * The one place an account sets its own picture.
 *
 * ── Why the picture is the control ────────────────────────────────────────
 *
 * DESIGN §10 asks a flourish to do a job. The job here is that "choose a file"
 * and "this is what people will see" are the same question, so they are the
 * same object: the 96px circle IS the file input and IS the drop target, and
 * the overlay that appears on it says which. A separate button beside a
 * preview would have made the preview decoration, and decoration is what
 * people stop looking at.
 *
 * Drag-and-drop here is genuinely the HTML5 file API rather than Pointer
 * Events, and that is the same distinction MediaSlots.jsx already draws:
 * §8's rule is about REORDERING, where a pointer implementation is the only
 * one touch can use. A file coming from the desktop is a different mechanism
 * with no touch equivalent at all — which is why the click path is not a
 * fallback here, it is the primary path, and the drop is the extra.
 *
 * ── The preview is local, and that matters ────────────────────────────────
 *
 * The circle shows an object URL of the chosen file the moment it is picked,
 * before any upload. On a slow connection a server round trip means several
 * seconds of looking at the old picture after choosing a new one, which reads
 * as the choice not having registered. What it must NOT do is imply the crop:
 * the server crops to a centred square with an attention pass, so the preview
 * is drawn in the same circle at the same size and the same `object-fit:
 * cover`, and what you see is what lands.
 */
export default function AvatarEditor({ user, onChange }) {
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);
  const previewUrl = useRef(null);

  const locked = user?.avatar_locked === true;
  const current = preview || user?.avatar_path || null;

  const releasePreview = () => {
    if (previewUrl.current) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
  };

  const send = async (file) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      toast.error('Choose an image — JPEG, PNG, WebP or GIF');
      return;
    }
    // The server refuses over 4 MB with a multer error that reads as a generic
    // failure. Saying it here means the person can pick a different file
    // instead of watching an upload die.
    if (file.size > 4 * 1024 * 1024) {
      toast.error('That image is over 4 MB — pick a smaller one');
      return;
    }

    releasePreview();
    previewUrl.current = URL.createObjectURL(file);
    setPreview(previewUrl.current);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      const res = await api.upload('/profiles/avatar', fd);
      toast.success('Profile picture updated');
      // The local preview has to go the moment the real path arrives, or the
      // circle keeps showing the ORIGINAL upload — uncropped, full size —
      // rather than the square the store actually publishes.
      releasePreview();
      setPreview(null);
      onChange?.(res);
    } catch (err) {
      releasePreview();
      setPreview(null);
      toast.error(err.message || 'Could not save that picture');
    } finally {
      setBusy(false);
      // Same file twice in a row fires no change event unless the input is
      // cleared — which is exactly what someone does after a failed upload.
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await api.delete('/profiles/avatar');
      releasePreview();
      setPreview(null);
      toast.success('Profile picture removed');
      onChange?.(res);
    } catch (err) {
      toast.error(err.message || 'Could not remove that picture');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="avatar-edit">
      <div
        className={`avatar-drop${dragOver ? ' avatar-drop-over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!locked) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!locked) send(e.dataTransfer.files?.[0]);
        }}
      >
        <AvatarImage username={user?.username} avatarPath={current} size={96} />
        {!locked && (
          <button
            type="button"
            className="avatar-drop-hint"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            aria-label={current ? 'Replace your profile picture' : 'Add a profile picture'}
          >
            {busy ? <span className="spinner spinner-inline" /> : <Camera size={22} aria-hidden="true" />}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif,image/tiff"
          hidden
          onChange={(e) => send(e.target.files?.[0])}
        />
      </div>

      <div className="avatar-edit-actions">
        {locked ? (
          <p className="avatar-edit-note">
            <Lock size={13} aria-hidden="true" /> Staff removed your picture and locked it.
            Open a support ticket if you think that was a mistake.
          </p>
        ) : (
          <>
            <div className="avatar-edit-buttons">
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                onClick={() => inputRef.current?.click()}
                disabled={busy}
              >
                <Upload size={13} aria-hidden="true" /> {user?.avatar_path ? 'Replace' : 'Choose a picture'}
              </button>
              {user?.avatar_path && (
                <button
                  type="button"
                  className="glass-btn glass-btn-sm prof-danger-text"
                  onClick={remove}
                  disabled={busy}
                >
                  <Trash2 size={13} aria-hidden="true" /> Remove
                </button>
              )}
            </div>
            {/* The promise is worth stating plainly, because it is the reason
                someone hesitating over a photograph should not hesitate. */}
            <p className="avatar-edit-note">
              Cropped to a square and re-encoded here, which strips the location, the device and
              the capture time your camera wrote into the file. The original is deleted; only the
              square the store made is kept, and only that is ever served.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
