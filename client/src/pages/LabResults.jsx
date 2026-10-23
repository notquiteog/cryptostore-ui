import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import MicroMarkdown from '../utils/microMarkdown';
import useDocumentHead from '../hooks/useDocumentHead';
import { clipDescription, plainMarkdown, ROBOTS_PRIVATE } from '../utils/documentHead';
import {
  FlaskConical, ChevronDown, CheckCircle2, XCircle, FileQuestion, Beaker,
} from 'lucide-react';

/**
 * Certificates of analysis, as kinetic drawers.
 *
 * Each entry is a physical-feeling accordion: the drawer slides open with an
 * elastic overshoot (grid-template-rows through a spring easing — see
 * 64-store-pages.css) rather than a rigid drop. The spring is the point: lab
 * results are the trust page, and an interface that feels engineered reads
 * as a store that is, too. Under prefers-reduced-motion the same drawers
 * simply open, instantly — the physics are decoration, never information.
 *
 * Only one drawer open at a time, on purpose: a COA is read one batch at a
 * time, and an "expand all" wall of tables reads as noise, not diligence.
 */
function CoaDrawer({ entry, open, onToggle, index }) {
  const failed = entry.pass === false;
  return (
    <div className={`coa-item${open ? ' open' : ''}${failed ? ' is-failed' : ''}`} style={{ '--i': index }}>
      <button
        type="button"
        className="coa-head"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="coa-head-main">
          <span className="coa-product">{entry.product}</span>
          {entry.batch && <span className="coa-batch">batch {entry.batch}</span>}
        </span>
        <span className="coa-head-side">
          <span className={`coa-verdict ${failed ? 'is-fail' : 'is-pass'}`}>
            {failed ? <XCircle size={13} aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
            {failed ? 'Fail' : 'Pass'}
          </span>
          <ChevronDown size={16} className="coa-chevron" aria-hidden="true" />
        </span>
      </button>

      <div className="coa-body">
        <div className="coa-body-inner">
          {(entry.lab || entry.tested_at) && (
            <div className="coa-meta">
              {entry.lab && <span><Beaker size={12} aria-hidden="true" /> {entry.lab}</span>}
              {entry.tested_at && <span>tested {entry.tested_at}</span>}
            </div>
          )}

          {entry.rows?.length > 0 && (
            <table className="coa-table">
              <thead>
                <tr>
                  <th>Analyte</th>
                  <th>Result</th>
                  <th>Limit</th>
                </tr>
              </thead>
              <tbody>
                {entry.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td>
                    <td className="coa-result">{r.result}{r.unit ? ` ${r.unit}` : ''}</td>
                    <td className="coa-limit">{r.limit || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {entry.note && <p className="coa-note">{entry.note}</p>}
        </div>
      </div>
    </div>
  );
}

export default function LabResults() {
  const [page, setPage] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [openIdx, setOpenIdx] = useState(null);

  useEffect(() => {
    api.get('/settings/pages/lab-results')
      .then(setPage)
      .catch(() => setMissing(true))
      .finally(() => setLoading(false));
  }, []);

  // See StorePage.jsx: the tab title, the snippet, and noindex when the page
  // is switched off — composed in one place rather than written here.
  useDocumentHead({
    title: missing ? 'Page not found' : page?.title,
    description: page ? clipDescription(plainMarkdown(page.body_md)) || undefined : undefined,
    robots: missing ? ROBOTS_PRIVATE : undefined,
  });

  if (loading) {
    return (
      <div className="page container store-page">
        <div className="skeleton" style={{ height: 36, width: '40%', marginBottom: 'var(--sp-6)' }} />
        {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 64, marginBottom: 'var(--sp-3)' }} />)}
      </div>
    );
  }

  if (missing || !page) {
    return (
      <div className="page container store-page">
        <div className="glass-card empty-state">
          <FileQuestion size={34} aria-hidden="true" />
          <h3>This page isn&apos;t available</h3>
          <p>It may have been switched off. The rest of the store is still here.</p>
          <Link to="/" className="glass-btn glass-btn-primary">Back to the store</Link>
        </div>
      </div>
    );
  }

  const entries = page.lab_results || [];

  return (
    <div className="page container store-page">
      <h1 className="store-page-title">
        <FlaskConical size={26} aria-hidden="true" /> {page.title}
      </h1>

      {page.body_md && (
        <MicroMarkdown className="store-page-body store-page-intro" source={page.body_md} />
      )}

      {entries.length === 0 ? (
        <div className="glass-card empty-state">
          <FlaskConical size={30} aria-hidden="true" />
          <h3>No results published yet</h3>
          <p>Certificates of analysis will appear here as they come in.</p>
        </div>
      ) : (
        <div className="coa-list">
          {entries.map((entry, i) => (
            <CoaDrawer
              key={i}
              index={Math.min(i, 11)}
              entry={entry}
              open={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? null : i)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
