import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { useAuth } from '../context/AuthContext';
import useKeyboardInset from '../hooks/useKeyboardInset';
import { api } from '../utils/api';
import { playSound } from '../utils/sounds';
import { io } from 'socket.io-client';
import { Link } from 'react-router-dom';
import {
  MessageCircle, X, Send, Minimize2, Maximize2, Paperclip, Trash2, Pencil,
  Check, ShieldAlert, ImageOff, Play, ChevronsLeft, Sparkle,
} from 'lucide-react';
import Avatar from './Avatar';
// Staff-only, and therefore not in a buyer's download.
//
// The chat widget is mounted on every storefront page, so a static import here
// put the staff draft tool — and everything it pulls in behind it
// (DraftTool, ThinkingDial, CatalogPicker) — into the bundle of every customer
// who never sees the button. It is rendered under `canModerate` a few hundred
// lines below; the import now waits for the same condition. Same argument as
// the route split in App.jsx, one level down.
// Chat-native rather than the shared `ReplyAssist`: see ChatReplyAssist's
// header for why a panel built for a ticket page is the wrong shape inside a
// 360px widget. Still lazy — a buyer never loads it.
const ChatReplyAssist = lazy(() => import('./admin/ai/ChatReplyAssist'));
import ArmoredText from './pgp/ArmoredText';
import toast from 'react-hot-toast';

let socket = null;

/** Matches the server's own window — see EDIT_WINDOW_MS in chatMessages.js. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_FILES = 4;

/**
 * The closed bubble on a touch screen opens on a leftward slide, not a tap.
 * TRAVEL is how far it can be dragged; OPEN_AT is the distance past which
 * letting go opens the chat. The dock hands TRAVEL to the CSS as a custom
 * property, so the track drawn behind the bubble and the distance the JS
 * clamps to are one number and cannot disagree.
 *
 * 128 rather than the 96 it started at: the track carries the words
 * "Slide to open" in the room the bubble has not yet slid into, and at 96
 * that room was 76px, which cut the label to "Slide to o" under the bubble
 * on the very first screenshot. The track also sizes to its own text
 * (77-live-chat.css), so an operator's wider display font lengthens the
 * track rather than the label.
 */
const SLIDE_TRAVEL = 128;
const SLIDE_OPEN_AT = 88;
/** Finger movement under this is a tap, not the start of a slide. */
const SLIDE_SLOP = 6;
/** How long the "slide to open" hint stays on screen after a tap. */
const SLIDE_HINT_MS = 1800;
/**
 * Whether the bubble wants the slide gesture. Gated on the pointer, never on
 * width — the same rule the CSS follows: a laptop at 700px still has a mouse,
 * and there a click opens the chat as it always did.
 */
const wantsSlide = () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

/**
 * Merge chat messages by id, newest copy of a row winning.
 *
 * The server closes a real gap on join: it emits the last 50 messages as
 * history, then re-emits anything committed after that snapshot as ordinary
 * `chat:message` events, because the client used to replace its whole array
 * with history and silently swallow a staff reply that landed mid-round-trip.
 * That fix deliberately trades the dropped message for a possible duplicate —
 * and rows here are keyed `key={msg.id}`, so a duplicate meant two React
 * children sharing a key: a console error plus reconciliation that can drop or
 * misplace the wrong one. Keying the merge on the id is what makes the
 * server's trade safe.
 *
 * It now carries a second job. Edits and deletions broadcast the WHOLE updated
 * row on the same `chat:message` event rather than a diff, so this merge is
 * also the upsert that applies them — one strategy instead of two that would
 * have to be kept in step. A widget that never saw the original message still
 * ends up with the current one, instead of an edit applied to nothing.
 *
 * Sorted by id rather than `created_at`: ids are assigned in commit order, so
 * they order the thread correctly even when two rows share a timestamp.
 */
function mergeById(existing, incoming) {
  const byId = new Map();
  for (const msg of existing) byId.set(msg.id, msg);
  for (const msg of incoming) byId.set(msg.id, msg);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * One attachment.
 *
 * Chat media is served statically, so this is a plain `<img>`/`<video>` rather
 * than the authenticated blob fetch support-ticket attachments use — see the
 * mount comment in server/index.js for that trade. What it must still handle
 * is the file being GONE: a moderator's delete unlinks the bytes, and any
 * widget holding the old row would otherwise draw a broken-image glyph.
 *
 * Videos get `preload="metadata"` and no autoplay. Four clips autoplaying in a
 * scrolling room is a room nobody can read, and on a metered connection it is
 * megabytes nobody asked for.
 */
function Attachment({ att, canRemove, onRemove }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <div className="lc-att lc-att-gone">
        <ImageOff size={14} aria-hidden="true" />
        <span>attachment removed</span>
      </div>
    );
  }

  return (
    <div className="lc-att">
      {att.media_type === 'video' ? (
        <video
          className="lc-att-media"
          src={att.url}
          poster={att.poster || undefined}
          controls
          preload="metadata"
          playsInline
          onError={() => setBroken(true)}
        />
      ) : (
        /* Opens full size in a new tab rather than in a lightbox: the widget is
           360px wide and floats over the page, so a lightbox inside it would be
           smaller than the thumbnail it replaced. */
        <a href={att.url} target="_blank" rel="noopener noreferrer" className="lc-att-link">
          <img className="lc-att-media" src={att.url} alt="" loading="lazy" onError={() => setBroken(true)} />
        </a>
      )}
      {att.media_type === 'video' && !att.poster && (
        <span className="lc-att-badge" aria-hidden="true"><Play size={11} /></span>
      )}
      {canRemove && (
        <button
          type="button"
          className="lc-att-remove"
          onClick={() => onRemove(att.id)}
          aria-label="Remove this attachment"
          title="Remove this attachment"
        >
          <Trash2 size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * One message row.
 *
 * Split out because it now holds real state — an open editor — and keeping
 * that in the parent meant one `editingId` plus one `editingText` that had to
 * be reset on every incoming broadcast, which is how an edit-in-progress ends
 * up being clobbered by somebody else's message arriving.
 */
function ChatRow({ msg, mine, canModerate, onEdit, onDelete, onRemoveAttachment }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(msg.body);
  const editRef = useRef(null);

  useEffect(() => {
    if (editing) {
      editRef.current?.focus();
      // Caret at the end rather than selecting everything: an edit is almost
      // always an addition or a fix at the end, and a select-all means the
      // first keystroke destroys the message.
      const len = editRef.current?.value.length ?? 0;
      editRef.current?.setSelectionRange(len, len);
    }
  }, [editing]);

  if (msg.deleted) {
    /* A tombstone, drawn as one. The row stays because removing it would make
       the conversation read as though nothing was ever there — and because
       staff need to see that something was. */
    return (
      <div className="lc-msg lc-msg-gone">
        <ShieldAlert size={13} aria-hidden="true" />
        <span>Message removed</span>
      </div>
    );
  }

  const editable = mine && (Date.now() - new Date(msg.created_at).getTime()) < EDIT_WINDOW_MS;
  const removable = mine || canModerate;

  const submitEdit = () => {
    const next = draft.trim();
    if (!next || next === msg.body) { setEditing(false); return; }
    onEdit(msg.id, next);
    setEditing(false);
  };

  return (
    <div className={`lc-msg${mine ? ' is-mine' : ''}`}>
      <Avatar username={msg.username} avatarPath={msg.avatar_path} size={26} className="lc-msg-avatar" />
      <div className="lc-msg-body">
        <div className="lc-msg-head">
          <span className={`lc-msg-who lc-role-${msg.role || 'user'}`}>{msg.username}</span>
          <span className="lc-msg-time" title={new Date(msg.created_at).toLocaleString()}>
            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {msg.edited_at && (
            <span className="lc-msg-edited" title={`Edited ${new Date(msg.edited_at).toLocaleString()}`}>
              edited
            </span>
          )}
        </div>

        {editing ? (
          <div className="lc-edit">
            <textarea
              ref={editRef}
              className="glass-input lc-edit-input"
              value={draft}
              rows={2}
              maxLength={2000}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); }
                if (e.key === 'Escape') { setDraft(msg.body); setEditing(false); }
              }}
              aria-label="Edit your message"
            />
            <div className="lc-edit-actions">
              <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={submitEdit}>
                <Check size={12} aria-hidden="true" /> Save
              </button>
              <button type="button" className="glass-btn glass-btn-sm" onClick={() => { setDraft(msg.body); setEditing(false); }}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* A pasted encrypted block is drawn as one, with the audited
                decrypt for staff who may read addresses — the same panel the
                order page uses, compacted for a 380px column. */}
            {msg.body && <ArmoredText as="div" className="lc-msg-text" text={msg.body} context="live chat" compact />}
            {msg.attachments?.length > 0 && (
              <div className="lc-atts">
                {msg.attachments.map((att) => (
                  <Attachment
                    key={att.id}
                    att={att}
                    canRemove={removable}
                    onRemove={onRemoveAttachment}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* DESIGN §4: row actions on hover, revealed without reflow — the space
          is reserved, so a row does not change height under the cursor and
          turn a mis-click into a click on the wrong message. Reachable by
          keyboard through `:focus-within`, and permanently visible on a coarse
          pointer, where there is no hover to reveal them with. */}
      {!editing && (editable || removable) && (
        <div className="lc-msg-tools">
          {editable && (
            <button type="button" onClick={() => { setDraft(msg.body); setEditing(true); }} title="Edit" aria-label="Edit this message">
              <Pencil size={12} aria-hidden="true" />
            </button>
          )}
          {removable && (
            <button
              type="button"
              onClick={() => onDelete(msg.id)}
              title={mine ? 'Delete' : 'Remove as staff'}
              aria-label={mine ? 'Delete this message' : 'Remove this message as staff'}
              className={mine ? undefined : 'lc-mod'}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function LiveChat() {
  const { user } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const [canModerate, setCanModerate] = useState(false);
  // The assistant's answer to the last thing this person sent, when no staff
  // were in the room. Deliberately NOT in `messages`: it is per-socket and
  // ephemeral, it is not in the transcript, and it is not something staff said.
  // At most one is held — a second question replaces the answer to the first,
  // because a stack of automatic answers under a chat window is a bot.
  const [assistant, setAssistant] = useState(null);
  const [pending, setPending] = useState([]); // Files chosen, not yet sent.
  const [sending, setSending] = useState(false);
  // Which message id is one press from being removed. Inline, never
  // `window.confirm()` — a browser that has been told to suppress dialogs
  // returns false from it forever, which turns the button into a no-op with
  // nothing on screen. Same fix as the profile page's device list.
  const [confirmDelete, setConfirmDelete] = useState(null);
  const messagesEnd = useRef(null);
  const fileRef = useRef(null);
  // The closed bubble's slide gesture. `slide` is how far left the bubble
  // sits right now (px, 0..SLIDE_TRAVEL); `dragging` while a finger owns it;
  // `hinting` while the "slide to open" hint is showing after a tap.
  const [slide, setSlide] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [hinting, setHinting] = useState(false);
  const gesture = useRef(null);       // { id, x, y, moved } — the pointer that owns the bubble
  const swallowClick = useRef(false); // the click that trails a handled pointer sequence
  const hintTimer = useRef(null);
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  // Whether the panel is the phone's sheet rather than the desktop card. This
  // mirrors the `max-width: 600px` block in 77-live-chat.css and has to keep
  // mirroring it — the CSS decides what the panel looks like, this decides
  // whether it is worth watching the keyboard for. Change one, change the
  // other. (Buddy.jsx carries the same pairing against its own 640px query.)
  const [phoneSheet, setPhoneSheet] = useState(false);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(max-width: 600px)');
    const sync = () => setPhoneSheet(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  /*
   * Where the keyboard is, while the sheet is open.
   *
   * The desktop card floats clear of the bottom edge and the minimised strip
   * has no field in it, so neither has anything to correct. See
   * hooks/useKeyboardInset for what the number means and why the phone sheet
   * cannot simply sit at `bottom: 0`.
   */
  const keyboard = useKeyboardInset(open && !minimized && phoneSheet);

  useEffect(() => {
    if (!user) return;
    api.get('/push/chat-status').then(data => setEnabled(data.enabled)).catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!open || !user) return;

    const token = localStorage.getItem('token');
    socket = io({
      path: '/socket.io',
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('chat:join');
    });

    socket.on('disconnect', () => setConnected(false));

    // Whether this account may remove other people's messages. Told by the
    // server on join rather than guessed from the role: `support.chat` is
    // grantable to a manager who holds none of the other staff powers, and
    // deriving it here would mean either shipping the permission list to every
    // client or getting it wrong for exactly that manager.
    socket.on('chat:capabilities', (caps) => setCanModerate(!!caps?.can_moderate));

    socket.on('chat:history', (history) => {
      // Merged, not assigned: anything already on screen — including a message
      // broadcast while this history query was in flight — has to survive.
      setMessages(prev => mergeById(prev, Array.isArray(history) ? history : []));
    });

    socket.on('chat:message', (msg) => {
      setMessages(prev => mergeById(prev, [msg]));
      // Someone ELSE spoke — your own send echoing back is not news, and
      // neither is an edit or a deletion, which arrive on this same event.
      // This is the one sound that can fire without a fresh gesture; sounds.js
      // skips it silently when the browser hasn't unlocked audio yet.
      const isNew = !msg.edited_at && !msg.deleted;
      if (isNew && msg?.username && msg.username !== user?.username) playSound('notify');
    });

    /*
     * ── The assistant's first response ──
     *
     * Sent to this socket only, when the operator has turned the first
     * responder on AND no member of staff is in the room. It is never a
     * `chat:message`, and that is the point: it is not stored, it is not
     * broadcast to the other customers in this shared room, and it is not
     * something staff can be held to having said. The buyer's own message has
     * already gone through as normal.
     *
     * Kept out of `messages` for the same reason. That array is the chat's
     * transcript and everything in it has an id, an author and a place in the
     * history; folding a per-socket ephemeral answer into it would mean
     * inventing all three.
     */
    socket.on('chat:assistant', (hint) => {
      if (!hint?.answer) return;
      setAssistant(hint);
    });

    socket.on('chat:rate_limited', (e) => toast.error(e?.error || 'Slow down a moment'));
    // Refusals used to be a silent `return` on the server, so an edit outside
    // the window left the textarea open with no explanation.
    socket.on('chat:error', (e) => toast.error(e?.error || 'That did not work'));

    socket.on('chat:disabled', () => {
      setEnabled(false);
      setOpen(false);
    });

    return () => {
      if (socket) {
        socket.disconnect();
        socket = null;
      }
    };
  }, [open, user]);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Object URLs are pinned in memory until revoked, so a session of choosing
  // and cancelling files would leak every preview.
  useEffect(() => () => { pending.forEach((p) => URL.revokeObjectURL(p.preview)); }, [pending]);

  const addFiles = useCallback((list) => {
    const chosen = [...(list || [])];
    if (chosen.length === 0) return;
    setPending((prev) => {
      const room = MAX_FILES - prev.length;
      if (room <= 0) {
        toast.error(`At most ${MAX_FILES} files per message`);
        return prev;
      }
      const taken = chosen.slice(0, room).map((file) => ({
        file,
        preview: URL.createObjectURL(file),
        isVideo: file.type.startsWith('video/'),
      }));
      if (chosen.length > room) toast.error(`Only ${room} more file${room === 1 ? '' : 's'} fit on this message`);
      return [...prev, ...taken];
    });
  }, []);

  const dropPending = (i) => setPending((prev) => {
    const gone = prev[i];
    if (gone) URL.revokeObjectURL(gone.preview);
    return prev.filter((_, n) => n !== i);
  });

  if (!user || !enabled) return null;

  const sendMessage = async (e) => {
    e.preventDefault();
    const body = input.trim();
    if ((!body && pending.length === 0) || sending) return;

    // Two pipes, one writer on the server. Text alone rides the socket that is
    // already open; anything with a file goes over HTTP multipart, because
    // socket.io buffers a whole frame in memory and a 60 MB phone video would
    // block every other message in the room while it arrives.
    if (pending.length === 0) {
      if (!socket) return;
      socket.emit('chat:send', { body });
      setInput('');
      return;
    }

    setSending(true);
    try {
      const fd = new FormData();
      fd.append('body', body);
      for (const p of pending) fd.append('files', p.file);
      await api.upload('/chat/messages', fd);
      // The server broadcasts into the room, so the sent message arrives back
      // through the socket like anybody else's — nothing to append here.
      setInput('');
      pending.forEach((p) => URL.revokeObjectURL(p.preview));
      setPending([]);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      toast.error(err.message || 'Could not send that');
    } finally {
      setSending(false);
    }
  };

  const editMessage = (id, body) => socket?.emit('chat:edit', { id, body });
  const removeAttachment = (id) => socket?.emit('chat:delete_attachment', { id });
  const deleteMessage = (id) => {
    socket?.emit('chat:delete', { id });
    setConfirmDelete(null);
  };

  /* ── The closed bubble: slide to open on touch ───────────────────────────
     On a phone the bubble sits in the thumb's resting zone, just above the
     tab bar, and a tap there mid-scroll opened a full-height sheet over the
     catalogue. So on a touch screen the bubble has to be slid left to open,
     and a tap shows how instead. Pointer Events with capture (DESIGN §8), so
     a finger that wanders off the 52px circle mid-slide is still the
     bubble's. There is no long-press to start: the bubble is
     `touch-action: pan-y`, so a vertical drag on it still scrolls the page
     and the browser cancels us — the reason §8 gives for the delay, met
     without one.

     Desktop is untouched. With a hovering pointer, pointerdown returns
     before tracking anything and the click opens as it always did. That
     click path is also the non-drag fallback §8 requires: a keyboard
     Enter/Space and a screen reader's synthesised activation both arrive as
     a click with no pointer sequence in front of it, and neither of those
     opens a sheet by accident, so both open it directly. */
  const showSlideHint = () => {
    clearTimeout(hintTimer.current);
    setHinting(true);
    hintTimer.current = setTimeout(() => setHinting(false), SLIDE_HINT_MS);
  };
  const endSlide = () => {
    gesture.current = null;
    setDragging(false);
    setSlide(0);
  };
  const onFabPointerDown = (e) => {
    if (!wantsSlide() || !e.isPrimary) return;
    // A hint still playing would hold the bubble's transform; the finger
    // now owns it. Dropping the class here is also what lets a second tap
    // replay the hint from the start.
    clearTimeout(hintTimer.current);
    setHinting(false);
    gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
    // Capture is what lets the finger wander off the circle mid-slide; it is
    // not what the slide depends on. A pointer already gone by the time we
    // ask throws NotFoundError, and that is nothing to crash a render over.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* slide continues uncaptured */ }
  };
  const onFabPointerMove = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dx = g.x - e.clientX; // leftward is positive
    if (!g.moved) {
      if (Math.abs(dx) < SLIDE_SLOP && Math.abs(e.clientY - g.y) < SLIDE_SLOP) return;
      g.moved = true;
      setDragging(true);
    }
    setSlide(Math.min(SLIDE_TRAVEL, Math.max(0, dx)));
  };
  const onFabPointerUp = (e) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dx = g.x - e.clientX;
    endSlide();
    // The click the browser fires after this sequence is the tail of a
    // gesture already decided here, not an activation. The timer is the
    // safety net for a browser that fires no click after a drag: without
    // it the flag would swallow the next keyboard activation instead.
    swallowClick.current = true;
    setTimeout(() => { swallowClick.current = false; }, 400);
    if (!g.moved) showSlideHint();
    else if (dx >= SLIDE_OPEN_AT) setOpen(true);
  };
  const onFabClick = () => {
    if (swallowClick.current) { swallowClick.current = false; return; }
    setOpen(true);
  };

  if (!open) {
    const armed = slide >= SLIDE_OPEN_AT;
    return (
      // The dock is the fixed element — it is what the mobile tab bar's
      // clearance rule in 08-navbar.css lifts over the bar — and the button
      // inside it is what slides. On a hovering pointer the track never
      // renders and the dock is the bubble's old fixed corner under another
      // name.
      <div
        className={`livechat-dock${dragging ? ' is-dragging' : ''}${hinting ? ' is-hinting' : ''}${armed ? ' is-armed' : ''}`}
        style={{ '--lc-travel': `${SLIDE_TRAVEL}px`, '--lc-slide': `${slide}px` }}
      >
        {/* One label, always the same words. A second one for the armed
            state ("release to open") was tried and could not be read: by
            the time the slide is far enough the bubble is sitting on the
            label. Far enough is said by the thing under the finger instead
            — the bubble lifts and the track's rim lights (`is-armed`). */}
        <div className="livechat-track" aria-hidden="true">
          <ChevronsLeft size={14} aria-hidden="true" />
          <span>Slide to open</span>
        </div>
        <button
          type="button"
          className="livechat-fab"
          title="Live Chat"
          aria-label="Open live chat"
          onClick={onFabClick}
          onPointerDown={onFabPointerDown}
          onPointerMove={onFabPointerMove}
          onPointerUp={onFabPointerUp}
          onPointerCancel={endSlide}
        >
          <MessageCircle size={24} aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`livechat-panel${minimized ? ' is-min' : ''}`}
      /* The keyboard's geometry, handed to the stylesheet rather than acted on
         here — the same contract Buddy.jsx has with 100-ai-buddy.css. Zero and
         absent everywhere the sheet is not a sheet, so the phone block's
         `max()` collapses to the rule it always had. */
      data-kb={keyboard.inset > 0 ? 'true' : undefined}
      style={{ '--lc-kb': `${keyboard.inset}px` }}
    >
      <div className="lc-head" onClick={() => setMinimized(m => !m)}>
        <div className="lc-head-title">
          <MessageCircle size={17} aria-hidden="true" /> Live chat
          {/* Connection state as a lit dot, not a word: it is glanced at, not
              read, and §3 says glow means live. */}
          <span className={`lc-dot${connected ? ' is-live' : ''}`} title={connected ? 'Connected' : 'Reconnecting…'} />
          {canModerate && <span className="lc-mod-badge" title="You can remove messages in this room">staff</span>}
        </div>
        <div className="lc-head-tools">
          <button onClick={(e) => { e.stopPropagation(); setMinimized(m => !m); }} aria-label={minimized ? 'Expand' : 'Minimise'}>
            {minimized ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); setOpen(false); }} aria-label="Close live chat">
            <X size={15} />
          </button>
        </div>
      </div>

      {!minimized && (
        <>
          <div
            className="lc-log"
            /* Dropping a file anywhere on the log attaches it. The input is
               still the primary path — this is the extra, and it is a file
               drop from the desktop rather than a reorder, which is why it is
               the HTML5 API and not Pointer Events (DESIGN §8). */
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
          >
            {messages.length === 0 && (
              <div className="lc-empty">
                <MessageCircle size={22} aria-hidden="true" />
                <p>Nobody has said anything yet. Ask about an order, a product, or shipping.</p>
              </div>
            )}
            {messages.map(msg => (
              confirmDelete === msg.id ? (
                <div key={msg.id} className="lc-msg lc-msg-confirm">
                  <span>Remove this message?</span>
                  <button type="button" className="glass-btn glass-btn-sm glass-btn-danger" onClick={() => deleteMessage(msg.id)}>
                    Remove
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setConfirmDelete(null)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <ChatRow
                  key={msg.id}
                  msg={msg}
                  mine={msg.username === user.username}
                  canModerate={canModerate}
                  onEdit={editMessage}
                  onDelete={setConfirmDelete}
                  onRemoveAttachment={removeAttachment}
                />
              )
            ))}
            {/*
              * The assistant's answer, at the foot of the window under the
              * message it answers.
              *
              * Visibly NOT a chat message: its own plate, its own icon, a label
              * naming what wrote it, and a line saying a person will still
              * reply. A customer who thinks they have been dealt with by the
              * shop and then hears nothing for a day has been failed worse than
              * one who waited from the start — so the label is not decoration,
              * it is the feature's honesty condition.
              */}
            {assistant && (
              <div className="lc-assist" role="status">
                <div className="lc-assist-head">
                  <Sparkle size={13} aria-hidden="true" />
                  <span>Answered automatically — nobody is on the desk right now</span>
                  <button
                    type="button"
                    className="lc-assist-close"
                    onClick={() => setAssistant(null)}
                    aria-label="Dismiss this answer"
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </div>
                <p className="lc-assist-body">{assistant.answer}</p>
                {assistant.actions?.length > 0 && (
                  <div className="lc-assist-links">
                    {assistant.actions.slice(0, 3).map((a) => (
                      <Link key={a.id} to={a.href} onClick={() => setOpen(false)}>{a.title}</Link>
                    ))}
                  </div>
                )}
                <p className="lc-assist-foot">
                  Your message is waiting for a person either way — they will reply here.
                </p>
              </div>
            )}
            <div ref={messagesEnd} />
          </div>

          {/* Chosen files, before sending. Shown as thumbnails rather than
              filenames: a phone camera's filename says nothing, and the whole
              question at this moment is "is that the right picture". */}
          {pending.length > 0 && (
            <div className="lc-pending">
              {pending.map((p, i) => (
                <div className="lc-pending-item" key={p.preview}>
                  {p.isVideo
                    ? <video className="lc-pending-media" src={p.preview} muted playsInline />
                    : <img className="lc-pending-media" src={p.preview} alt="" />}
                  <button type="button" onClick={() => dropPending(i)} aria-label="Remove this file">
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              ))}
              <span className="lc-pending-note">
                Metadata is stripped and video is cut to 30s when it uploads.
              </span>
            </div>
          )}

          <form onSubmit={sendMessage} className="lc-compose">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,image/heic,image/heif,image/avif,image/tiff,video/x-matroska,video/x-msvideo"
              multiple
              hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
            />
            <button
              type="button"
              className="lc-attach"
              onClick={() => fileRef.current?.click()}
              title="Attach a photo or clip"
              aria-label="Attach a photo or clip"
              disabled={sending}
            >
              <Paperclip size={16} aria-hidden="true" />
            </button>
            <input
              className="glass-input lc-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Type a message…"
              maxLength={2000}
              disabled={sending}
            />
            {/* Inside the form on purpose — the trigger is a flex child of
                this row, and the draft strip positions itself against it. The
                component hides itself for anybody without `support.chat`, for
                a store with `ai_chat_reply_assist` off (which is the default),
                and again for one with the capability switched off. It sends
                nothing: it writes into the box above, and the button below is
                still the only thing that posts. */}
            {canModerate && (
              <Suspense fallback={null}>
                <ChatReplyAssist onUse={setInput} />
              </Suspense>
            )}
            <button
              type="submit"
              className="glass-btn glass-btn-primary glass-btn-sm"
              disabled={!connected || sending || (!input.trim() && pending.length === 0)}
              aria-label="Send"
            >
              {sending ? <span className="spinner spinner-inline" /> : <Send size={15} aria-hidden="true" />}
            </button>
          </form>

        </>
      )}
    </div>
  );
}
