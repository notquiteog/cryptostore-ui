import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookText, Plus, Pencil, Trash2, CornerDownLeft, Sparkle, Search, X, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';

/**
 * The answers the support desk types over and over.
 *
 * ── Two ways to use one snippet, and the second is the interesting one ──────
 *
 * **Insert** puts the text in the composer, which is what a snippet library is
 * normally for.
 *
 * **Draft from it** hands the same text to the AI reply draft as its
 * instruction (`prompts.supportReply`'s `notes`). That is not a second-class
 * shortcut: a snippet states the shop's policy, and a model given that policy
 * plus the customer's actual question produces a reply about THIS order that
 * follows it — rather than a paragraph the staff member then has to personalise
 * by hand. The library becomes the shop's knowledge and the model becomes the
 * personalisation step.
 *
 * It is also why the snippets carry no `{{placeholder}}` syntax. A template with
 * holes in it is a worse version of both uses: pasted it needs hand-editing, and
 * handed to a model it is noise.
 *
 * ── Why the list is not alphabetical ────────────────────────────────────────
 *
 * It is ordered by how often each snippet has been reached for (the server sorts
 * on `uses`). A library sorted by title is one where the three answers used
 * daily sit among thirty written once, and a desk then stops opening it. The
 * counter records presses and nothing else — no who, no when, no ticket.
 *
 * ── Shared, and edited behind a different grant ─────────────────────────────
 *
 * Everybody with `support.reply` reads the list; `support.manage` edits it,
 * because a snippet is the shop's wording and changing the shop's wording is not
 * the same permission as using it. The server answers `can_manage`, so the
 * editing controls are absent rather than present and failing.
 */
export default function SavedReplies({ onInsert, onDraftFrom }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState(null);
  const [canManage, setCanManage] = useState(false);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/support/saved-replies');
      setRows(Array.isArray(res?.saved_replies) ? res.saved_replies : []);
      setCanManage(Boolean(res?.can_manage));
    } catch {
      // Silent: the composer works without the library, and a red box under the
      // reply box for a typing shortcut that could not load is noise in the
      // middle of somebody answering a customer.
      setRows([]);
    }
  }, []);

  useEffect(() => { if (open && rows === null) load(); }, [open, rows, load]);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows || [];
    return (rows || []).filter((r) => `${r.title} ${r.category || ''} ${r.body}`.toLowerCase().includes(q));
  }, [rows, query]);

  /** Tell the server a snippet was used, then hand the text to the caller. */
  const take = (row, how) => {
    // Fire and forget. The count is a sort key; a failure to bump it must never
    // be something the person answering a customer has to deal with.
    api.post(`/support/saved-replies/${row.id}/used`).catch(() => {});
    setRows((prev) => (prev || []).map((r) => (r.id === row.id ? { ...r, uses: (r.uses || 0) + 1 } : r)));
    setOpen(false);
    if (how === 'draft') onDraftFrom?.(row.body);
    else onInsert?.(row.body);
  };

  const save = async () => {
    const title = (editing.title || '').trim();
    const body = (editing.body || '').trim();
    if (!title || !body) return toast.error('A saved reply needs a title and some text');
    setBusy(true);
    try {
      if (editing.id) await api.put(`/support/saved-replies/${editing.id}`, { title, body, category: editing.category || '' });
      else await api.post('/support/saved-replies', { title, body, category: editing.category || '' });
      toast.success(editing.id ? 'Saved reply updated' : 'Saved reply added');
      setEditing(null);
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row) => {
    setBusy(true);
    try {
      await api.delete(`/support/saved-replies/${row.id}`);
      setRows((prev) => (prev || []).filter((r) => r.id !== row.id));
      toast.success('Deleted');
    } catch (err) {
      toast.error(err.message || 'Could not delete that');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="srp-trigger" onClick={() => setOpen(true)}>
        <BookText size={13} aria-hidden="true" /> Saved replies
      </button>
    );
  }

  return (
    <div className="srp" role="region" aria-label="Saved replies">
      <div className="srp-head">
        <span className="srp-title"><BookText size={13} aria-hidden="true" /> Saved replies</span>
        <div className="srp-head-actions">
          {canManage && !editing && (
            <button type="button" className="srp-action" onClick={() => setEditing({ title: '', body: '', category: '' })}>
              <Plus size={12} aria-hidden="true" /> New
            </button>
          )}
          <button type="button" className="srp-action" onClick={() => { setOpen(false); setEditing(null); }} aria-label="Close saved replies">
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      {editing ? (
        <div className="srp-edit">
          <input
            className="glass-input"
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            placeholder="What this answers — e.g. Changing a shipping address"
            aria-label="Title"
            maxLength={120}
          />
          <input
            className="glass-input"
            value={editing.category || ''}
            onChange={(e) => setEditing({ ...editing, category: e.target.value })}
            placeholder="Group it under… (optional)"
            aria-label="Category"
            maxLength={64}
          />
          <textarea
            className="glass-input srp-edit-body"
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            placeholder="The shop's answer, in the shop's words. No placeholders — the draft tool personalises it."
            aria-label="The reply"
            rows={5}
            maxLength={4000}
          />
          <div className="srp-edit-actions">
            <button type="button" className="glass-btn glass-btn-primary glass-btn-sm" onClick={save} disabled={busy}>
              <Check size={13} aria-hidden="true" /> {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            {editing.id && (
              <button
                type="button"
                className="glass-btn glass-btn-sm srp-delete"
                onClick={() => { remove(editing); setEditing(null); }}
                disabled={busy}
              >
                <Trash2 size={13} aria-hidden="true" /> Delete
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {/* The filter appears once the library is big enough to need it. Below
              that it is chrome on a list somebody can read in one glance. */}
          {(rows?.length || 0) > 6 && (
            <div className="srp-search">
              <Search size={13} aria-hidden="true" />
              <input
                className="glass-input"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter"
                aria-label="Filter saved replies"
              />
            </div>
          )}

          {rows === null && <p className="srp-state">Loading…</p>}

          {rows !== null && rows.length === 0 && (
            <p className="srp-state">
              {canManage
                ? 'Nothing saved yet. When you find yourself typing the same answer twice, save it here — it becomes both a paste and the instruction for a drafted reply.'
                : 'Nothing saved yet. Somebody with ticket management can add the answers this desk sends often.'}
            </p>
          )}

          {rows !== null && rows.length > 0 && matching.length === 0 && (
            <p className="srp-state">Nothing matches that. <button type="button" className="srp-inline" onClick={() => setQuery('')}>Clear the filter</button>.</p>
          )}

          {matching.length > 0 && (
            <ul className="srp-list">
              {matching.map((r) => (
                <li key={r.id} className="srp-item">
                  <div className="srp-item-head">
                    <span className="srp-item-title">{r.title}</span>
                    {r.category && <span className="srp-item-cat">{r.category}</span>}
                    {/* The count is the sort order made visible, so the list's
                        ordering does not look arbitrary. Hidden at zero: "used
                        0 times" on a new snippet reads as a criticism. */}
                    {r.uses > 0 && <span className="srp-item-uses">{r.uses}×</span>}
                  </div>
                  {/* Two lines of the body. Enough to tell two similar snippets
                      apart without turning a picker into a wall of prose. */}
                  <p className="srp-item-body">{r.body}</p>
                  <div className="srp-item-actions">
                    <button type="button" className="srp-action" onClick={() => take(r, 'insert')}>
                      <CornerDownLeft size={12} aria-hidden="true" /> Insert
                    </button>
                    {/* Only when the composer offered a draft target — the tool
                        is absent when this shop has the capability switched off,
                        and a button that hands text to nothing is worse than no
                        button. */}
                    {onDraftFrom && (
                      <button type="button" className="srp-action" onClick={() => take(r, 'draft')}>
                        <Sparkle size={12} aria-hidden="true" /> Draft from it
                      </button>
                    )}
                    {canManage && (
                      <button type="button" className="srp-action" onClick={() => setEditing({ ...r })}>
                        <Pencil size={12} aria-hidden="true" /> Edit
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
