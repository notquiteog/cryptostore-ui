import ProgressBar from '../../components/ProgressBar';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { changedWithBase } from '../../utils/settingsDiff';
import { reportSettingsError } from '../../utils/settingsConflict';
import MicroMarkdown from '../../utils/microMarkdown';
import toast from 'react-hot-toast';
import {
  FlaskConical, Save, Plus, Trash2, Eye, ExternalLink, CheckCircle2, XCircle,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import { findStorePage } from '../../config/storePages';

/**
 * The editor behind every operator-authored page.
 *
 * One component, four routes. These pages were a single screen with a tab
 * bar until the roster grew a fourth; a tab bar that duplicates the sidebar
 * is a second navigation the operator has to learn, and it made every page
 * unlinkable — "open the shipping policy" meant "go to Pages, then click
 * Shipping", and no bookmark or support answer could say it in a URL.
 *
 * Everything here is settings rows (config/pageKeys.js server-side), so
 * "disabled" is simply the absent default and no migration ever ran. Bodies
 * are markdown — never HTML — rendered by the same React-only renderer the
 * public pages use, so the preview pane IS the truth, not an approximation.
 */

const EMPTY_ENTRY = () => ({
  product: '', batch: '', lab: '', tested_at: '', pass: true, note: '', rows: [],
});
const EMPTY_ROW = () => ({ name: '', result: '', unit: '', limit: '' });

export default function StorePageEditor({ pageKey }) {
  const spec = findStorePage(pageKey);
  const [form, setForm] = useState({});
  /* The server's own values, so Save sends only what this operator changed.
     The comment on the loader below already noted that scoping the form to one
     page's keys keeps two tabs from overwriting each other; that argument stops
     at the page boundary, and two people editing the SAME page still needed
     this. See utils/settingsDiff. */
  const [saved, setSaved] = useState({});
  /* Bumped to re-read. A save that came back a conflict has proved this form is
     showing something stale, and the operator has to see the real values before
     they decide anything — see utils/settingsConflict. */
  const [reloadTick, setReloadTick] = useState(0);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!spec) return undefined;
    let cancelled = false;
    setLoading(true);
    api.get('/settings')
      .then((data) => {
        if (cancelled) return;
        const picked = {};
        for (const k of Object.values(spec.keys)) picked[k] = data[k] ?? '';
        setForm(picked);
        setSaved(picked);
        if (spec.lab) {
          try {
            const parsed = JSON.parse(data[spec.keys.results] || '[]');
            setEntries(Array.isArray(parsed) ? parsed : []);
          } catch {
            setEntries([]);
          }
        }
      })
      .catch(() => { if (!cancelled) toast.error('Failed to load this page'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Re-fetching per page keeps each editor's form holding only its own keys,
    // which is also what makes the save below safe: two pages open in two tabs
    // cannot overwrite each other's drafts, because neither one is carrying
    // the other's keys to send back.
  }, [pageKey, spec, reloadTick]);

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...form };
      if (spec.lab) payload[spec.keys.results] = JSON.stringify(entries);
      const pending = changedWithBase(payload, saved);
      if (!pending) {
        setSaving(false);
        return toast(`${spec.label} has no unsaved changes`);
      }
      await api.put('/settings', pending);
      setSaved(payload);
      toast.success(`${spec.label} saved`);
    } catch (err) {
      reportSettingsError(err, () => setReloadTick((n) => n + 1));
    }
    setSaving(false);
  };

  // ── Lab entry helpers ──
  const patchEntry = (i, changes) => setEntries((es) => es.map((e, j) => (j === i ? { ...e, ...changes } : e)));
  const patchRow = (i, ri, changes) => setEntries((es) => es.map((e, j) => (
    j === i ? { ...e, rows: e.rows.map((r, k) => (k === ri ? { ...r, ...changes } : r)) } : e
  )));

  // A route that names a page this build does not have. Reachable only by
  // typing the URL, but it must not render a blank editor that silently saves
  // nothing.
  if (!spec) {
    return (
      <div className="admin-page" style={{ maxWidth: 980 }}>
        <div className="glass-card empty-state">
          <h3>No such page</h3>
          <p>Pick one from the Pages section in the sidebar.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--sp-12)' }}>
        <ProgressBar label="Loading page editor…" />
      </div>
    );
  }

  const enabled = form[spec.keys.enabled] === 'true';

  return (
    <div className="admin-page" style={{ maxWidth: 980 }}>
      <PageHeader icon={spec.icon} title={spec.label} subtitle={spec.blurb}>
        {/* Named by the page's own label, so "Privacy" and "Lab results" each
            ask about themselves rather than about "custom pages" in general. */}
        <AskAbout
          question={`In the admin panel's Custom pages editors, what does the "${spec.label}" page do, who can see it, and does the assistant read from it when answering buyers?`}
          title={`Ask the assistant about the ${spec.label} page`}
        />
        <button className="glass-btn glass-btn-primary" onClick={save} disabled={saving}>
          <Save size={14} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </PageHeader>

      <div className="glass-card" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className={`setting-row${enabled ? ' is-on' : ''}`} style={{ marginBottom: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="setting-row-text">
              <label htmlFor={`page-on-${spec.key}`} className="setting-row-title" style={{ cursor: 'pointer' }}>
                <Eye size={15} style={{ color: enabled ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }} />
                Publish this page
              </label>
              <div className="setting-row-hint">
                Off, the page answers the same 404 as a page that never existed — drafts stay
                private until you flip this. Save to apply either way.
                {enabled && (
                  <>
                    {' '}Live at{' '}
                    <Link to={spec.path} target="_blank" style={{ color: 'var(--primary)' }}>
                      {spec.path} <ExternalLink size={11} style={{ verticalAlign: '-1px' }} />
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
          <label className="switch">
            <input
              id={`page-on-${spec.key}`}
              type="checkbox"
              checked={enabled}
              onChange={(e) => set(spec.keys.enabled, e.target.checked ? 'true' : 'false')}
            />
            <span className="switch-track" />
          </label>
        </div>
      </div>

      <div className="glass-card" style={{ marginBottom: 'var(--sp-5)' }}>
        <div className="form-group">
          <label htmlFor={`page-title-${spec.key}`}>Page title</label>
          <input
            id={`page-title-${spec.key}`}
            className="glass-input"
            value={form[spec.keys.title] || ''}
            onChange={(e) => set(spec.keys.title, e.target.value)}
            placeholder={spec.defaultTitle}
            maxLength={80}
          />
        </div>

        <div className="form-group" style={{ marginBottom: 0 }}>
          <label htmlFor={`page-md-${spec.key}`}>
            {spec.lab ? 'Introduction (markdown, shown above the results)' : 'Content (markdown)'}
          </label>
          <div className="pages-editor-grid">
            <textarea
              id={`page-md-${spec.key}`}
              className="glass-input pages-md-input"
              value={form[spec.keys.md] || ''}
              onChange={(e) => set(spec.keys.md, e.target.value)}
              placeholder={'# Heading\n\nWrite markdown here — **bold**, *italic*, [links](https://…), lists, quotes.'}
              spellCheck="true"
            />
            <div className="pages-preview">
              <div className="pages-preview-label">Live preview — exactly what visitors see</div>
              <MicroMarkdown className="store-page-body" source={form[spec.keys.md] || ''} />
            </div>
          </div>
        </div>
      </div>

      {spec.lab && (
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
              <FlaskConical size={16} style={{ color: 'var(--accent)' }} />
              Certificates of analysis
            </h3>
            <button
              type="button"
              className="glass-btn glass-btn-sm glass-btn-primary"
              onClick={() => setEntries((es) => [EMPTY_ENTRY(), ...es])}
            >
              <Plus size={13} /> Add result
            </button>
          </div>

          {entries.length === 0 && (
            <p className="admin-hint" style={{ marginBottom: 0 }}>
              No entries yet. Each one renders as a spring-loaded drawer on the public page:
              product, batch, lab, verdict, and a table of analytes.
            </p>
          )}

          {entries.map((entry, i) => (
            <div key={i} className="coa-editor-item">
              <div className="coa-editor-head">
                <span style={{ fontWeight: 600, fontSize: 'var(--fs-base)', minWidth: 0 }}>
                  {entry.product || `Entry ${i + 1}`}
                </span>
                <div style={{ display: 'flex', gap: 'var(--sp-15)', alignItems: 'center' }}>
                  <button
                    type="button"
                    className={`glass-btn glass-btn-sm${entry.pass !== false ? ' glass-btn-success' : ' glass-btn-danger'}`}
                    onClick={() => patchEntry(i, { pass: entry.pass === false })}
                    title="Toggle the published verdict"
                  >
                    {entry.pass !== false
                      ? <><CheckCircle2 size={13} /> Pass</>
                      : <><XCircle size={13} /> Fail</>}
                  </button>
                  <button
                    type="button"
                    className="glass-btn glass-btn-sm"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => setEntries((es) => es.filter((_, j) => j !== i))}
                    aria-label={`Remove entry ${entry.product || i + 1}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              <div className="coa-editor-grid">
                <div className="form-group">
                  <label>Product</label>
                  <input className="glass-input" value={entry.product || ''} maxLength={120}
                    onChange={(e) => patchEntry(i, { product: e.target.value })} placeholder="OG Kush 3.5g" />
                </div>
                <div className="form-group">
                  <label>Batch</label>
                  <input className="glass-input" value={entry.batch || ''} maxLength={60}
                    onChange={(e) => patchEntry(i, { batch: e.target.value })} placeholder="B-2408" />
                </div>
                <div className="form-group">
                  <label>Lab</label>
                  <input className="glass-input" value={entry.lab || ''} maxLength={120}
                    onChange={(e) => patchEntry(i, { lab: e.target.value })} placeholder="Acme Analytics" />
                </div>
                <div className="form-group">
                  <label>Tested</label>
                  <input className="glass-input" type="date" value={entry.tested_at || ''}
                    onChange={(e) => patchEntry(i, { tested_at: e.target.value })} />
                </div>
              </div>

              <div className="form-group">
                <label>Analytes</label>
                {(entry.rows || []).map((row, ri) => (
                  <div key={ri} className="coa-row-grid">
                    <input className="glass-input" style={{ margin: 0 }} value={row.name} maxLength={80}
                      onChange={(e) => patchRow(i, ri, { name: e.target.value })} placeholder="THC" aria-label="Analyte name" />
                    <input className="glass-input" style={{ margin: 0 }} value={row.result} maxLength={40}
                      onChange={(e) => patchRow(i, ri, { result: e.target.value })} placeholder="24.1" aria-label="Result" />
                    <input className="glass-input" style={{ margin: 0 }} value={row.unit} maxLength={20}
                      onChange={(e) => patchRow(i, ri, { unit: e.target.value })} placeholder="%" aria-label="Unit" />
                    <input className="glass-input" style={{ margin: 0 }} value={row.limit} maxLength={40}
                      onChange={(e) => patchRow(i, ri, { limit: e.target.value })} placeholder="limit / range" aria-label="Limit" />
                    <button type="button" className="glass-btn glass-btn-sm" style={{ color: 'var(--danger)' }}
                      onClick={() => patchEntry(i, { rows: entry.rows.filter((_, k) => k !== ri) })}
                      aria-label="Remove analyte row">
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="glass-btn glass-btn-sm"
                  onClick={() => patchEntry(i, { rows: [...(entry.rows || []), EMPTY_ROW()] })}
                >
                  <Plus size={12} /> Add analyte
                </button>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>Note (optional)</label>
                <input className="glass-input" value={entry.note || ''} maxLength={500}
                  onChange={(e) => patchEntry(i, { note: e.target.value })}
                  placeholder="Full report available on request." />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
