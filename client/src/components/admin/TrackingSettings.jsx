import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Truck, ShieldCheck, Globe, Network, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '../../utils/api';

/**
 * The "Package tracking" card on the Settings page.
 *
 * One switch, then everything the switch implies: which way the lookups
 * leave the building, how often, which carriers can actually be asked with
 * the credentials on file, and what the worker is doing right now.
 *
 * ── What the card refuses to offer ─────────────────────────────────────────
 *
 * A "check now" button. The worker asks one carrier about one parcel at a
 * time, never sooner than two hours after the last look at that parcel —
 * server/config/trackingKeys.js has the reasoning, and the interval field
 * below will not accept a number under two. What the card shows instead is
 * the queue: how many parcels are waiting, when the next look is, and when
 * the last one happened. A reader who wants to know whether the thing works
 * can see it working.
 *
 * ── Credentials ────────────────────────────────────────────────────────────
 *
 * The server never sends a stored secret back. A field that holds one
 * arrives as the marker `__keep__` and is drawn as "set — leave to keep";
 * typing replaces it, clearing removes it. `redactCarrierKeys` on the server
 * decides the shape and `validateCarrierKeys` merges it back.
 */

const KEEP = '__keep__';

/** What each carrier's official API wants, in the words their portals use. */
const CREDENTIAL_LABELS = {
  usps: { client_id: 'Consumer Key', client_secret: 'Consumer Secret' },
  ups: { client_id: 'Client ID', client_secret: 'Client Secret' },
  fedex: { api_key: 'API Key', secret_key: 'Secret Key' },
  dhl: { api_key: 'API Key' },
  royal_mail: { client_id: 'Client ID', client_secret: 'Client Secret' },
};

const ROUTES = [
  {
    value: 'tor',
    title: 'Through Tor — the local SOCKS proxy',
    badge: 'Default',
    hint: 'The same Tor proxy on 9050/9150 the rest of the store dials. The carrier sees a Tor exit, never this server. Carriers block many exits, so expect some lookups to be refused — the queue shows which. The right choice when the server must not be linked to the parcels it sends.',
  },
  {
    value: 'proxies',
    title: 'Through the outbound proxy pool — external IPs',
    hint: 'Not Tor. Rotates through the addresses you configured under Outbound proxies below: a residential line, a mobile connection, a workplace egress — the kind of address a carrier does not block. What it costs is trusting whoever runs each of them with the traffic. Needs at least one enabled proxy.',
  },
  {
    value: 'direct',
    title: 'Directly from this server',
    tone: 'warn',
    hint: 'Every lookup names this server\'s address to the carrier alongside a parcel bound for a buyer. Fine for a clearnet store on its own infrastructure; wrong for anyone the first sentence of CLAUDE.md is written for.',
  },
];

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const agoOrIn = (iso) => {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  const text = mins < 2 ? 'now' : mins < 60 ? `${mins} min` : mins < 24 * 60 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`;
  if (text === 'now') return 'now';
  return ms < 0 ? `${text} ago` : `in ${text}`;
};

export default function TrackingSettings({ settings, handleChange, SettingsSection, SwitchRow, canEdit = true }) {
  const enabled = settings.tracking_enabled === 'true';
  const route = settings.tracking_route || 'tor';
  const keys = (() => { try { return JSON.parse(settings.tracking_carrier_keys || '{}') || {}; } catch { return {}; } })();
  const [status, setStatus] = useState(null);
  const [statusErr, setStatusErr] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(false);

  const loadStatus = useCallback(() => {
    setLoadingStatus(true);
    api.get('/settings/tracking/status')
      .then((d) => { setStatus(d); setStatusErr(null); })
      .catch((e) => setStatusErr(e.message || 'Could not read the tracking queue'))
      .finally(() => setLoadingStatus(false));
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const setKey = (carrier, field, value) => {
    const next = { ...keys, [carrier]: { ...(keys[carrier] || {}), [field]: value } };
    handleChange('tracking_carrier_keys', JSON.stringify(next));
  };

  const adapters = status?.adapters || [];
  const carrierStatus = new Map((status?.carriers || []).map((c) => [c.code, c]));

  return (
    <SettingsSection
      id="package-tracking"
      title="Package tracking"
      icon={Truck}
      lede="Ask the carriers where each parcel is, slowly, on this server's own clock, and show the answer beside every tracking number — the order page, the Orders lists, the Ship desk, the manifest, both bots and the assistant. Off, the store shows tracking numbers exactly as before."
    >
      <SwitchRow
        id="tracking-enabled"
        title="Look parcels up automatically"
        hint="A background worker takes one tracking number at a time, asks its carrier, stores the answer, and moves on. No parcel is asked about more than once every two hours, whatever the settings below say, and nothing on any page asks a carrier on demand — there is no refresh button anywhere, on purpose. Every lookup is an outbound request that names one parcel; a slow, even queue is the shape that says the least about the order book."
        icon={Truck}
        checked={enabled}
        onChange={(on) => handleChange('tracking_enabled', on ? 'true' : 'false')}
      >
        <div className="aset-fields">
          <div className="form-group">
            <label>Where the lookups leave from</label>
            <div className="trk-routes" role="radiogroup" aria-label="Tracking route">
              {ROUTES.map((r) => (
                <label key={r.value} className={`trk-route${route === r.value ? ' is-on' : ''}`}>
                  <input type="radio" name="tracking-route" value={r.value} checked={route === r.value} onChange={() => handleChange('tracking_route', r.value)} disabled={!canEdit} />
                  <span>
                    <span className="trk-route-title">
                      {r.value === 'tor' && <Network size={14} aria-hidden="true" />}
                      {r.value === 'proxies' && <Globe size={14} aria-hidden="true" />}
                      {r.value === 'direct' && <AlertTriangle size={14} aria-hidden="true" style={{ color: 'var(--warning)' }} />}
                      {r.title}
                      {r.badge && <span className="badge badge-primary">{r.badge}</span>}
                    </span>
                    <span className="trk-route-hint">{r.hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {route === 'proxies' && (
              <p className="setting-row-hint" style={{ marginTop: 'var(--sp-2)' }}>
                The pool is defined under <a href="#outbound-proxies" onClick={(e) => { e.preventDefault(); document.querySelector('[data-settings-section="outbound-proxies"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Outbound proxies</a> on this page.
              </p>
            )}
          </div>

          <div className="form-group" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 'var(--sp-3)' }}>
            <div>
              <label htmlFor="tracking-interval">Look again every (hours)</label>
              <input id="tracking-interval" className="glass-input" type="number" min="2" max="168" step="1" value={settings.tracking_interval_hours ?? '6'} onChange={(e) => handleChange('tracking_interval_hours', e.target.value)} disabled={!canEdit} />
              <p className="setting-row-hint">Never below 2. A parcel out for delivery is looked at every two hours regardless; a delivered one is never looked at again.</p>
            </div>
            <div>
              <label htmlFor="tracking-spacing">Gap between lookups (seconds)</label>
              <input id="tracking-spacing" className="glass-input" type="number" min="10" max="3600" step="5" value={settings.tracking_spacing_seconds ?? '45'} onChange={(e) => handleChange('tracking_spacing_seconds', e.target.value)} disabled={!canEdit} />
              <p className="setting-row-hint">The pause between one carrier request and the next, across the whole queue. 45 s clears 200 parcels in two and a half hours.</p>
            </div>
            <div>
              <label htmlFor="tracking-max-age">Stop after (days)</label>
              <input id="tracking-max-age" className="glass-input" type="number" min="3" max="365" step="1" value={settings.tracking_max_age_days ?? '60'} onChange={(e) => handleChange('tracking_max_age_days', e.target.value)} disabled={!canEdit} />
              <p className="setting-row-hint">A number older than this leaves the queue, delivered or not.</p>
            </div>
            <div>
              <label htmlFor="tracking-stalled">Flag as stalled after (days)</label>
              <input id="tracking-stalled" className="glass-input" type="number" min="1" max="60" step="1" value={settings.tracking_stalled_days ?? '5'} onChange={(e) => handleChange('tracking_stalled_days', e.target.value)} disabled={!canEdit} />
              <p className="setting-row-hint">No carrier movement for this long on an undelivered parcel lights it on the order page.</p>
            </div>
          </div>

          <SwitchRow
            id="tracking-notify-buyer"
            title="Tell the buyer when the carrier says something worth hearing"
            hint="Out for delivery, delivered, ready for collection, or a problem — on every channel they have linked. The message names the carrier and the state, never the number and never a place; those are on the order page, behind their login."
            checked={settings.tracking_notify_buyer !== 'false'}
            onChange={(on) => handleChange('tracking_notify_buyer', on ? 'true' : 'false')}
          />
          <SwitchRow
            id="tracking-notify-staff"
            title="Tell staff about delivery exceptions and returns"
            hint="A parcel the carrier could not deliver, or one on its way back, pages the staff channels the way a funded-but-unconfirmed payment does. Also counted on the dashboard's Parcels flagged tile."
            checked={settings.tracking_notify_staff !== 'false'}
            onChange={(on) => handleChange('tracking_notify_staff', on ? 'true' : 'false')}
          />
          <SwitchRow
            id="tracking-auto-deliver"
            title="Mark an order delivered when every parcel on it is"
            hint="Completes a shipped order the moment its last tracked parcel reports delivered — the same transition Auto-finalize takes, with the same consequences: the sub-user reward is paid and the buyer's dispute window starts. Off, the carrier's word is shown and the order waits for Auto-finalize or a person. A box the packer marked untracked does not hold the order up."
            tone="warn"
            checked={settings.tracking_auto_deliver === 'true'}
            onChange={(on) => handleChange('tracking_auto_deliver', on ? 'true' : 'false')}
          />
          <SwitchRow
            id="tracking-page-fallback"
            title="Read a carrier's public page when it has no API credential"
            hint="Only UPS answers a plain request today; USPS, FedEx, DHL and Royal Mail refuse anything that is not a browser and need the credential below. The page route is fragile by nature — it works until the carrier decides it should not — and every way it fails is recorded on the parcel rather than shown as a status."
            checked={settings.tracking_page_fallback !== 'false'}
            onChange={(on) => handleChange('tracking_page_fallback', on ? 'true' : 'false')}
          />

          <div className="form-group" id="tracking-credentials">
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}><ShieldCheck size={14} aria-hidden="true" /> Carrier credentials</label>
            <p className="setting-row-hint">Each carrier's official tracking API is free to register for and is the reliable route. Stored encrypted-at-rest with the other secrets; never sent back to this page. Leave a field showing &quot;set&quot; alone to keep what is stored.</p>
            <div className="trk-carriers">
              {(adapters.length ? adapters : Object.keys(CREDENTIAL_LABELS).map((code) => ({ code, label: code, modes: [] }))).map((a) => {
                const labels = CREDENTIAL_LABELS[a.code] || {};
                const live = carrierStatus.get(a.code);
                const mode = a.modes?.includes('api') ? 'api' : a.modes?.includes('page') ? 'page' : 'off';
                return (
                  <div key={a.code} className="trk-carrier">
                    <div className="trk-carrier-name">
                      <span>{a.label}</span>
                      <span className={`trk-carrier-mode is-${mode}`}>
                        {mode === 'api' ? 'official API' : mode === 'page' ? 'public page only' : 'cannot be asked'}
                      </span>
                      {live && (
                        <span className="trk-carrier-mode" title={live.last_checked_at ? `last checked ${fmtWhen(live.last_checked_at)}` : undefined}>
                          {live.numbers} parcel{live.numbers === 1 ? '' : 's'}{live.failing ? ` · ${live.failing} failing` : ''}
                        </span>
                      )}
                    </div>
                    <div className="trk-carrier-fields">
                      {Object.entries(labels).map(([field, label]) => {
                        const v = keys[a.code]?.[field] ?? '';
                        const kept = v === KEEP;
                        return (
                          <div key={field}>
                            <label htmlFor={`trk-${a.code}-${field}`}>{label}{kept && <span className="field-opt"> (set — leave to keep)</span>}</label>
                            <input
                              id={`trk-${a.code}-${field}`}
                              className="glass-input"
                              type="password"
                              autoComplete="new-password"
                              value={kept ? '' : v}
                              placeholder={kept ? '••••••••' : ''}
                              onChange={(e) => setKey(a.code, field, e.target.value === '' && kept ? KEEP : e.target.value)}
                              onFocus={(e) => { if (kept) e.target.placeholder = 'type to replace, or leave blank'; }}
                              disabled={!canEdit}
                            />
                            {kept && (
                              <button type="button" className="glass-btn glass-btn-sm" style={{ marginTop: 'var(--sp-1)' }} onClick={() => setKey(a.code, field, '')} disabled={!canEdit}>Clear</button>
                            )}
                          </div>
                        );
                      })}
                      {a.credential_help && <p className="trk-carrier-help">{a.credential_help}</p>}
                      {live?.last_error && <p className="trk-carrier-err"><AlertTriangle size={11} aria-hidden="true" /> Last error: {live.last_error}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </SwitchRow>

      {/* ── The queue ── */}
      <div className="form-group" style={{ marginTop: 'var(--sp-3)' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', justifyContent: 'space-between' }}>
          <span>The queue right now</span>
          <button type="button" className="glass-btn glass-btn-sm" onClick={loadStatus} disabled={loadingStatus} title="Re-read the queue counts — this does not ask any carrier anything">
            <RefreshCw size={12} aria-hidden="true" /> {loadingStatus ? 'Reading…' : 'Re-read'}
          </button>
        </label>
        {statusErr && <p className="setting-row-hint" style={{ color: 'var(--danger)' }}>{statusErr}</p>}
        {status && (
          <>
            <div className="trk-status">
              <div className="trk-stat"><span className="trk-stat-value">{status.queued}</span><span className="trk-stat-label">in the queue</span></div>
              <div className="trk-stat"><span className="trk-stat-value">{status.due}</span><span className="trk-stat-label">due now</span></div>
              <div className={`trk-stat${status.attention ? ' is-attention' : ' is-ok'}`}><span className="trk-stat-value">{status.attention}</span><span className="trk-stat-label">flagged by carrier</span></div>
              <div className="trk-stat"><span className="trk-stat-value">{status.finished}</span><span className="trk-stat-label">finished</span></div>
              {status.parked > 0 && <div className="trk-stat is-attention"><span className="trk-stat-value">{status.parked}</span><span className="trk-stat-label">waiting for a credential</span></div>}
              {status.unsupported > 0 && <div className="trk-stat"><span className="trk-stat-value">{status.unsupported}</span><span className="trk-stat-label">no known carrier</span></div>}
              {/* Parcels the worker stopped following because their order
                  closed. Counted separately from "finished" so the card does
                  not read as if every one of them was delivered. */}
              {status.stopped_with_order > 0 && <div className="trk-stat"><span className="trk-stat-value">{status.stopped_with_order}</span><span className="trk-stat-label">stopped with the order</span></div>}
            </div>
            <p className="setting-row-hint">
              {status.enabled
                ? <>Worker {status.running ? 'running' : 'not running'} · route <strong>{status.route}</strong> · every {status.interval_hours} h, {status.spacing_seconds} s apart · last look {status.last_checked_at ? `${agoOrIn(status.last_checked_at)} (${fmtWhen(status.last_checked_at)})` : 'never'}{status.next_at ? ` · next ${agoOrIn(status.next_at)}` : ''}{status.session?.checks ? ` · this process: ${status.session.ok} ok, ${status.session.failed} failed` : ''}</>
                : <>Lookups are off. The numbers above are what was stored before, or by the demo seed.</>}
              {status.last_run?.message && status.enabled && <> · last: <code style={{ fontSize: 'var(--fs-2xs)' }}>{status.last_run.message}</code></>}
            </p>
            <p className="setting-row-hint">
              Parcels the carrier flagged are on the <Link to="/admin/orders?parcel=attention">Orders page</Link> and the dashboard.
            </p>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
