import { useState, useEffect, useMemo, useCallback } from 'react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';
import {
  Shield, Search, Check, AlertTriangle, ChevronDown, ChevronRight, Sparkles, X,
  BookMarked, Plus, Pencil, RotateCcw,
} from 'lucide-react';

/**
 * Editor for a manager's permission set.
 *
 * The catalogue is served by the API rather than duplicated here, so adding a
 * permission on the server makes it appear in this UI without a client change.
 * It is fetched once per page load and shared between rows.
 */

let catalogPromise = null;
function loadCatalog() {
  if (!catalogPromise) {
    catalogPromise = api.get('/admin/permissions').catch((err) => {
      catalogPromise = null;
      throw err;
    });
  }
  return catalogPromise;
}

/** A profile write changes what the next editor instance must see. */
function invalidateCatalog() {
  catalogPromise = null;
}

const chip = (active, sensitive) => ({
  display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-2)',
  padding: 'var(--sp-2) var(--sp-2)',
  borderRadius: 'var(--radius-sm, 6px)',
  border: `1px solid ${active ? (sensitive ? 'var(--warning)' : 'var(--primary)') : 'var(--border)'}`,
  background: active ? (sensitive ? 'rgba(255,171,64,0.10)' : 'rgba(108,99,255,0.12)') : 'transparent',
  cursor: 'pointer', textAlign: 'left', width: '100%',
  transition: 'border-color 0.15s, background 0.15s',
});

function PermissionRow({ def, active, onToggle, disabled }) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onToggle(def.key)}
      disabled={disabled}
      style={{ ...chip(active, def.sensitive), opacity: disabled ? 0.5 : 1 }}
      title={def.key}
    >
      <span style={{
        width: 15, height: 15, marginTop: 1, flexShrink: 0,
        borderRadius: 3,
        border: `1px solid ${active ? (def.sensitive ? 'var(--warning)' : 'var(--primary)') : 'var(--border)'}`,
        background: active ? (def.sensitive ? 'var(--warning)' : 'var(--primary)') : 'transparent',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {active && <Check size={11} color="#fff" strokeWidth={3} />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{def.label}</span>
          {def.sensitive && (
            <span style={{ fontSize: 'var(--fs-3xs)', color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-05)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <AlertTriangle size={9} /> sensitive
            </span>
          )}
        </span>
        <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 'var(--sp-05)', lineHeight: 1.35 }}>
          {def.description}
        </span>
      </span>
    </button>
  );
}

function Category({ category, granted, onToggle, onSetMany, query, disabled }) {
  const [open, setOpen] = useState(true);

  const visible = useMemo(() => {
    if (!query) return category.permissions;
    const q = query.toLowerCase();
    return category.permissions.filter((p) =>
      p.key.toLowerCase().includes(q)
      || p.label.toLowerCase().includes(q)
      || p.description.toLowerCase().includes(q));
  }, [category.permissions, query]);

  if (visible.length === 0) return null;

  const grantable = category.permissions.filter((p) => !p.adminOnly);
  const heldCount = grantable.filter((p) => granted.has(p.key)).length;
  const allHeld = heldCount === grantable.length && grantable.length > 0;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius, 8px)', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
        padding: 'var(--sp-2) var(--sp-25)', background: 'var(--surface-active, rgba(var(--tint-rgb), 0.03))',
      }}>
        <button type="button" onClick={() => setOpen((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', padding: 0 }}>
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700 }}>{category.label}</span>
        </button>
        <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
          {heldCount}/{grantable.length}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onSetMany(grantable.map((p) => p.key), !allHeld)}
            className="glass-btn glass-btn-sm"
            style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', padding: 'var(--sp-05) var(--sp-2)' }}
          >
            {allHeld ? 'Clear' : 'Select all'}
          </button>
        )}
      </div>

      {open && (
        <div style={{ padding: 'var(--sp-2)', display: 'grid', gap: 'var(--sp-15)' }}>
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0 0 0.15rem' }}>{category.description}</p>
          {visible.map((def) => (
            def.adminOnly ? (
              <div key={def.key} style={{ ...chip(false, false), cursor: 'default', opacity: 0.6 }}>
                <span style={{ width: 15, flexShrink: 0 }} />
                <span>
                  <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)' }}>{def.label}</span>
                  <span style={{ fontSize: 'var(--fs-3xs)', color: 'var(--danger)', marginLeft: 'var(--sp-15)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>admin only</span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginTop: 'var(--sp-05)', lineHeight: 1.35 }}>
                    {def.description}
                  </span>
                </span>
              </div>
            ) : (
              <PermissionRow
                key={def.key}
                def={def}
                active={granted.has(def.key)}
                onToggle={onToggle}
                disabled={disabled}
              />
            )
          ))}
        </div>
      )}
    </div>
  );
}

export default function PermissionEditor({ value, onChange, disabled }) {
  const [catalog, setCatalog] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  // Operator-defined profiles, editable in place. Seeded from the catalogue
  // fetch, then owned locally so a save reflects without a refetch.
  const [profiles, setProfiles] = useState({});
  const [profileName, setProfileName] = useState('');
  const [savingProfiles, setSavingProfiles] = useState(false);
  // Which profile the save control updates; null means "save as new".
  const [editingProfile, setEditingProfile] = useState(null);

  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((data) => {
        if (!alive) return;
        setCatalog(data);
        setProfiles(data.profiles && typeof data.profiles === 'object' ? data.profiles : {});
      })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, []);

  /**
   * Persist the profile library. This is the ONE surface that writes it:
   * profiles are templates, so saving them touches store_settings, not any
   * user — applying one to a user still goes through the normal grant path
   * with its own permission check and audit entry.
   */
  const persistProfiles = async (next, doneMsg) => {
    setSavingProfiles(true);
    try {
      await api.put('/settings', { permission_profiles: JSON.stringify(next) });
      setProfiles(next);
      invalidateCatalog();
      toast.success(doneMsg);
    } catch (err) {
      toast.error(err?.data?.invalid?.[0]?.error || err.message || 'Could not save profiles');
    }
    setSavingProfiles(false);
  };

  // Grants arrive as the granular keys the checkboxes speak. There is no
  // translation step: the server stores exactly one name per capability, so a
  // key that does not match a box is a key that grants nothing.
  const granted = useMemo(() => new Set(value || []), [value]);

  const emit = useCallback((next) => onChange([...next]), [onChange]);

  const toggle = useCallback((key) => {
    const next = new Set(granted);
    if (next.has(key)) next.delete(key); else next.add(key);
    emit(next);
  }, [granted, emit]);

  const setMany = useCallback((keys, on) => {
    const next = new Set(granted);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    emit(next);
  }, [granted, emit]);

  const applyPreset = (preset) => emit(new Set(preset.permissions));

  /**
   * Built-in presets folded together with the stored blob: an entry under a
   * built-in's key overrides it, `{deleted:true}` hides it, and everything
   * else is an operator profile. Built-ins therefore edit and delete like any
   * profile without ever being copied out of code — removing the stored entry
   * brings the stock one back.
   */
  const effective = useMemo(() => {
    const builtins = catalog?.presets || [];
    const list = [];
    const hidden = [];
    for (const preset of builtins) {
      const stored = profiles[preset.key];
      if (stored?.deleted) { hidden.push(preset); continue; }
      if (stored) {
        list.push({
          id: preset.key, label: stored.label, description: preset.description,
          permissions: stored.permissions || [], builtin: true, overridden: true,
        });
      } else {
        list.push({
          id: preset.key, label: preset.label, description: preset.description,
          permissions: preset.permissions, builtin: true, overridden: false,
        });
      }
    }
    for (const [id, p] of Object.entries(profiles)) {
      if (p?.deleted || builtins.some((b) => b.key === id)) continue;
      list.push({ id, label: p.label, permissions: p.permissions || [], builtin: false, overridden: false });
    }
    return { list, hidden };
  }, [catalog, profiles]);

  const cancelEditProfile = () => {
    setEditingProfile(null);
    setProfileName('');
  };

  const editEntry = (entry) => {
    applyPreset(entry);
    setEditingProfile({ id: entry.id, label: entry.label, builtin: entry.builtin });
    setProfileName(entry.label);
  };

  const saveProfile = () => {
    const name = profileName.trim() || editingProfile?.label;
    if (!name) { toast.error('Name the profile first'); return; }
    if (editingProfile) {
      const next = { ...profiles, [editingProfile.id]: { label: name, permissions: [...granted] } };
      persistProfiles(next, `Updated "${name}" for everyone who grants permissions`);
      cancelEditProfile();
      return;
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!id) { toast.error('The name needs at least one letter or digit'); return; }
    // Overriding a built-in is its edit button's job, never a naming accident.
    if ((catalog?.presets || []).some((b) => b.key === id)) {
      toast.error('That name belongs to a built-in profile — use its edit button instead');
      return;
    }
    persistProfiles(
      { ...profiles, [id]: { label: name, permissions: [...granted] } },
      `Profile "${name}" saved for everyone who grants permissions`,
    );
    setProfileName('');
  };

  const deleteEntry = (entry) => {
    if (editingProfile?.id === entry.id) cancelEditProfile();
    const next = { ...profiles };
    if (entry.builtin) {
      next[entry.id] = { deleted: true };
      persistProfiles(next, `Hid built-in "${entry.label}" — restorable below`);
    } else {
      delete next[entry.id];
      persistProfiles(next, `Profile "${entry.label}" deleted`);
    }
  };

  const resetEntry = (entry) => {
    if (editingProfile?.id === entry.id) cancelEditProfile();
    const next = { ...profiles };
    delete next[entry.id];
    persistProfiles(next, `"${entry.label}" restored to the built-in`);
  };

  const restoreHidden = () => {
    const next = { ...profiles };
    for (const preset of effective.hidden) delete next[preset.key];
    persistProfiles(next, `Restored ${effective.hidden.length} built-in profile${effective.hidden.length === 1 ? '' : 's'}`);
  };

  if (error) {
    return <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>Could not load the permission catalogue: {error}</p>;
  }
  if (!catalog) {
    return <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading permissions…</p>;
  }

  const total = granted.size;

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text-secondary)' }}>
          <Shield size={14} /> Permissions
        </span>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          {total} granted — this manager can do nothing beyond a normal customer except what is ticked here.
        </span>
        {total > 0 && !disabled && (
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => emit(new Set())}
            style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)' }}>
            <X size={11} /> Clear all
          </button>
        )}
      </div>

      {/* Built-in presets and operator profiles, one editable roster. Every
          entry applies, edits and deletes; built-ins do it through stored
          overrides and tombstones, so the stock definition is always
          recoverable. Admin-only by construction: this editor renders only
          once the admin-only catalogue fetch has succeeded. */}
      {!disabled && (
        <div style={{ display: 'flex', gap: 'var(--sp-15)', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
            <Sparkles size={11} /> Start from:
          </span>
          {effective.list.map((entry) => (
            <span key={entry.id} style={{ display: 'inline-flex', alignItems: 'stretch' }}>
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                onClick={() => applyPreset(entry)}
                title={`${entry.description || 'Your profile'} — ${entry.permissions.length} permissions${entry.overridden ? ' (edited)' : ''}`}
                style={{
                  fontSize: 'var(--fs-2xs)', padding: 'var(--sp-05) var(--sp-2)',
                  borderTopRightRadius: 0, borderBottomRightRadius: 0,
                  ...(entry.overridden ? { borderColor: 'var(--warning)' } : {}),
                }}
              >
                {!entry.builtin && <BookMarked size={10} />}
                {entry.label}
              </button>
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                onClick={() => editEntry(entry)}
                disabled={savingProfiles}
                title={`Edit "${entry.label}" — loads its permissions; Update profile saves them back`}
                aria-label={`Edit profile "${entry.label}"`}
                style={{ fontSize: 'var(--fs-2xs)', padding: 'var(--sp-05) var(--sp-1)', borderRadius: 0, borderLeft: 'none' }}
              >
                <Pencil size={10} />
              </button>
              {entry.overridden && (
                <button
                  type="button"
                  className="glass-btn glass-btn-sm"
                  onClick={() => resetEntry(entry)}
                  disabled={savingProfiles}
                  title={`Discard your edits to "${entry.label}" and restore the built-in`}
                  aria-label={`Restore built-in "${entry.label}"`}
                  style={{ fontSize: 'var(--fs-2xs)', padding: 'var(--sp-05) var(--sp-1)', borderRadius: 0, borderLeft: 'none' }}
                >
                  <RotateCcw size={10} />
                </button>
              )}
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                onClick={() => deleteEntry(entry)}
                disabled={savingProfiles}
                title={entry.builtin ? `Hide built-in "${entry.label}" (restorable)` : `Delete profile "${entry.label}"`}
                aria-label={`Delete profile "${entry.label}"`}
                style={{ fontSize: 'var(--fs-2xs)', padding: 'var(--sp-05) var(--sp-1)', borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 'none', color: 'var(--danger)' }}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          {effective.hidden.length > 0 && (
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              onClick={restoreHidden}
              disabled={savingProfiles}
              title={effective.hidden.map((p) => p.label).join(', ')}
              style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-secondary)' }}
            >
              <RotateCcw size={10} /> Restore {effective.hidden.length} hidden
            </button>
          )}
        </div>
      )}

      {!disabled && (
        <div style={{ display: 'flex', gap: 'var(--sp-15)', alignItems: 'center', flexWrap: 'wrap' }}>
          {editingProfile && (
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
              <Pencil size={10} /> Editing “{editingProfile.label}”
            </span>
          )}
          <input
            className="glass-input"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveProfile(); } }}
            placeholder={editingProfile ? 'Rename the profile…' : 'Save ticked set as a profile…'}
            maxLength={60}
            style={{ margin: 0, fontSize: 'var(--fs-xs)', maxWidth: 230, minHeight: 30, padding: 'var(--sp-1) var(--sp-25)' }}
            aria-label={editingProfile ? `Rename profile ${editingProfile.label}` : 'New profile name'}
          />
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={saveProfile}
            disabled={savingProfiles}
            style={{ fontSize: 'var(--fs-2xs)' }}
          >
            {editingProfile
              ? <><Check size={11} /> {savingProfiles ? 'Saving…' : 'Update profile'}</>
              : <><Plus size={11} /> {savingProfiles ? 'Saving…' : 'Save profile'}</>}
          </button>
          {editingProfile && (
            <button type="button" className="glass-btn glass-btn-sm" onClick={cancelEditProfile} style={{ fontSize: 'var(--fs-2xs)' }}>
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Search */}
      <div style={{ position: 'relative' }}>
        <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          className="glass-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter permissions…"
          style={{ margin: 0, paddingLeft: 'var(--sp-6)', fontSize: 'var(--fs-sm)' }}
        />
      </div>

      <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
        {catalog.categories.map((category) => (
          <Category
            key={category.key}
            category={category}
            granted={granted}
            onToggle={toggle}
            onSetMany={setMany}
            query={query}
            disabled={disabled}
          />
        ))}
      </div>
    </div>
  );
}
