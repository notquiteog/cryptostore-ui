import { useState, useRef } from 'react';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import { Upload, Download, FileSpreadsheet } from 'lucide-react';

/**
 * The CSV order-export / product-import card.
 *
 * Lived at the bottom of the Coupons page for a long time because the ROUTES
 * live under /coupons — but neither tool has anything to do with coupons, and
 * operators looked for them under Settings. The card moved; the routes did
 * not, because renaming a mounted API path breaks any operator script that
 * already curls it.
 */

/**
 * The multipart field name the import route expects.
 *
 * server/routes/coupons.js mounts the route as `upload.single('csv')`, and
 * multer rejects the whole request with "Unexpected field" the moment it sees a
 * part under any other name. This used to be appended as `file`, so every
 * import died in the middleware before `importProductsCsv` ran and the page
 * could only report a bare "Import failed" — the feature had never once worked.
 * Named here rather than inlined so the coupling to the route is visible.
 */
const IMPORT_FIELD = 'csv';

export default function CsvTools() {
  const [importFile, setImportFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef(null);

  const handleImport = async () => {
    if (!importFile) return toast.error('Select a CSV file first');
    setImporting(true);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append(IMPORT_FIELD, importFile);
      const result = await api.post('/coupons/products-import', formData);
      setImportResult(result);
      // The endpoint reports per-row failures alongside the counts rather than
      // failing the request, so a 200 does not mean every line landed.
      const failed = result?.errors?.length ?? 0;
      if (failed > 0) toast(`Import finished with ${failed} error${failed === 1 ? '' : 's'}`);
      else toast.success('Import complete');
    } catch (err) {
      toast.error(err.message || 'Import failed');
    }
    setImporting(false);
  };

  /**
   * Pull the export through fetch instead of letting the browser navigate.
   *
   * This was an `<a href download>`. A top-level navigation carries no
   * Authorization header, and the JWT lives in localStorage rather than a
   * cookie, so `authenticate` answered 401 and the browser saved that JSON
   * error body to disk as the "export" — a 39-byte file and no explanation,
   * because api.js's 401 handling only runs for fetches it made itself.
   * Fetching attaches the header, and the object URL hands over the bytes the
   * server actually produced. `api.get` cannot be used: it always parses the
   * response as JSON and this endpoint sends text/csv.
   */
  const handleExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/coupons/orders-export', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (HTTP ${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'orders.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking in the same task can cancel the download that click just
      // started, so the URL is released once the browser has taken it.
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      toast.error(err.message || 'Failed to export orders');
    }
    setExporting(false);
  };

  return (
    <div className="glass-card" style={{ marginBottom: 'var(--sp-6)' }}>
      <h3 style={{ marginBottom: 'var(--sp-4)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
        <FileSpreadsheet size={20} /> CSV Tools
      </h3>
      <div className="admin-split">
        <div>
          <p className="admin-hint">Download every order as a spreadsheet.</p>
          <button
            type="button"
            className="glass-btn glass-btn-primary"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting
              ? <><span className="spinner spinner-inline" /> Exporting…</>
              : <><Download size={14} /> Export orders</>}
          </button>
        </div>

        <div>
          <p className="admin-hint">Import products from a CSV file.</p>
          <div className="admin-file-row">
            <input
              ref={fileRef}
              id="settings-csv"
              type="file"
              accept=".csv"
              className="admin-file-input"
              onChange={(e) => { setImportFile(e.target.files[0] || null); setImportResult(null); }}
            />
            <label htmlFor="settings-csv" className="glass-btn glass-btn-sm">
              <Upload size={13} /> Choose file
            </label>
            <span className="admin-file-name">{importFile ? importFile.name : 'No file chosen'}</span>
            <button
              className="glass-btn glass-btn-primary glass-btn-sm"
              onClick={handleImport}
              disabled={!importFile || importing}
            >
              {importing ? <><span className="spinner spinner-inline" /> Importing…</> : 'Import'}
            </button>
          </div>

          {/*
            The counts are `created_groups` / `created_variants` and `errors`
            is an array of per-row messages, not a number. Reading `groups`,
            `variants` and `errors > 0` meant a successful import reported
            "Imported 0 groups, 0 variants" and the rows that failed were
            silently dropped — the one place that says which line was bad.
          */}
          {importResult && (
            <div className="admin-result">
              Imported {importResult.created_groups ?? 0} groups, {importResult.created_variants ?? 0} variants
              {importResult.errors?.length > 0 && (
                <>
                  <span className="text-danger">
                    {' '}({importResult.errors.length} error{importResult.errors.length !== 1 ? 's' : ''})
                  </span>
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: 'var(--sp-4)', color: 'var(--danger)' }}>
                    {importResult.errors.map((msg, i) => (
                      <li key={i} style={{ marginBottom: 'var(--sp-05)' }}>{msg}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
