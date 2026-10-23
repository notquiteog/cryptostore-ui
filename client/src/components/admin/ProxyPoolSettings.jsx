import { useEffect, useState, useCallback } from 'react';
import { Globe, Plus, Trash2, ArrowUp, ArrowDown, Network, PlugZap, CircleCheck, CircleX } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';

/**
 * The "Outbound proxies" card: the pool of routes the store may send
 * third-party traffic through, and how it rotates them.
 *
 * A PROXY here is a route — one to four hops dialled in order, the last of
 * which reaches the destination (server/utils/proxyChain). A hop is a
 * SOCKS5 or HTTP(S) proxy with an optional login, or "the store's Tor
 * proxy", so "Tor, then my residential line" is one entry.
 *
 * ── Passwords ──────────────────────────────────────────────────────────────
 *
 * The server never sends a stored password back: a hop arrives with
 * `has_password: true` and no password. This editor turns that into the
 * `__keep__` marker on the way out, so saving the card without touching a
 * password keeps it; typing replaces it; clearing removes it. Reordering a
 * hop whose password is kept loses the password — the server matches kept
 * passwords by position — and the row says so.
 *
 * ── Test ───────────────────────────────────────────────────────────────────
 *
 * "Test" dials the chain end to end to a well-known host and hangs up. It is
 * the one outbound connection this card makes on its own, it is audited, and
 * it never sends a request on the route — proof the chain works, nothing
 * more. The live health beside each row is what the tracking worker recorded
 * when it actually used the route.
 */

const KEEP = '__keep__';
const PROTOCOLS = [
  { value: 'socks5', label: 'SOCKS5' },
  { value: 'http', label: 'HTTP (CONNECT)' },
  { value: 'https', label: 'HTTPS (CONNECT over TLS)' },
  { value: 'tor', label: 'Store Tor proxy' },
];
const ROTATIONS = [
  { value: 'round_robin', label: 'Round robin — each lookup takes the next proxy' },
  { value: 'random', label: 'Random — any enabled proxy, each time' },
  { value: 'sticky', label: 'Sticky — one proxy until it fails, then the next' },
];

const parsePool = (raw) => {
  try {
    const p = JSON.parse(raw || '{}') || {};
    return { rotation: p.rotation || 'round_robin', proxies: Array.isArray(p.proxies) ? p.proxies : [] };
  } catch {
    return { rotation: 'round_robin', proxies: [] };
  }
};

const newId = () => `p_${Math.random().toString(16).slice(2, 8)}`;
const newHop = () => ({ protocol: 'socks5', host: '', port: '', username: '', password: '' });

/** The blob the server stores: kept passwords as the marker, `has_password` dropped. */
function serialize(pool) {
  return JSON.stringify({
    rotation: pool.rotation,
    proxies: pool.proxies.map((p) => ({
      id: p.id,
      label: p.label,
      enabled: p.enabled !== false,
      hops: p.hops.map((h) => {
        if (h.protocol === 'tor') return { protocol: 'tor' };
        const out = { protocol: h.protocol, host: h.host, port: h.port };
        if (h.username) out.username = h.username;
        if (h.password) out.password = h.password;
        else if (h.has_password) out.password = KEEP;
        return out;
      }),
    })),
  });
}

const fmtAgo = (iso) => {
  if (!iso) return null;
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return mins < 2 ? 'just now' : mins < 60 ? `${mins} min ago` : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} d ago`;
};

export default function ProxyPoolSettings({ settings, handleChange, SettingsSection, canEdit = true }) {
  const pool = parsePool(settings.outbound_proxies);
  const [health, setHealth] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState({});

  const loadHealth = useCallback(() => {
    api.get('/settings/proxies/status').then(setHealth).catch(() => {});
  }, []);
  useEffect(() => { loadHealth(); }, [loadHealth]);

  const update = (next) => handleChange('outbound_proxies', serialize(next));
  const setPool = (fn) => update(fn(pool));

  const addProxy = () => setPool((p) => ({ ...p, proxies: [...p.proxies, { id: newId(), label: `Proxy ${p.proxies.length + 1}`, enabled: true, hops: [newHop()] }] }));
  const removeProxy = (id) => setPool((p) => ({ ...p, proxies: p.proxies.filter((x) => x.id !== id) }));
  const patchProxy = (id, patch) => setPool((p) => ({ ...p, proxies: p.proxies.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));
  const patchHop = (id, i, patch) => patchProxy(id, { hops: pool.proxies.find((x) => x.id === id).hops.map((h, j) => (j === i ? { ...h, ...patch } : h)) });
  const moveHop = (id, i, dir) => {
    const hops = [...pool.proxies.find((x) => x.id === id).hops];
    const j = i + dir;
    if (j < 0 || j >= hops.length) return;
    [hops[i], hops[j]] = [hops[j], hops[i]];
    // A kept password is matched by position on the server; moving the hop
    // means it can no longer be kept, so say so rather than silently losing it.
    for (const h of [hops[i], hops[j]]) if (h.has_password && !h.password) h.moved = true;
    patchProxy(id, { hops });
  };

  const test = async (id) => {
    setTesting(id);
    try {
      const r = await api.post(`/settings/proxies/${id}/test`, {});
      setTestResult((t) => ({ ...t, [id]: r }));
      if (r.ok) toast.success(`Reached the destination in ${r.latencyMs} ms`);
      else toast.error(r.error || 'The chain did not connect');
      loadHealth();
    } catch (e) {
      setTestResult((t) => ({ ...t, [id]: { ok: false, error: e.message } }));
      toast.error(e.message || 'Test failed');
    } finally {
      setTesting(null);
    }
  };

  const healthFor = (id) => health?.proxies?.find((p) => p.id === id);
  const unsaved = health && health.proxies && pool.proxies.some((p) => !health.proxies.some((h) => h.id === p.id));

  return (
    <SettingsSection
      id="outbound-proxies"
      title="Outbound proxies"
      icon={Globe}
      lede="External addresses the store may send third-party requests from — a residential line, a mobile connection, a workplace egress — for the services that block Tor exits and datacentre ranges. This is not the Tor proxy: that is one local SOCKS port under Tor proxy above, and every consumer's route selector offers it separately. Each entry here is one or more hops in order — a SOCKS5 or HTTP proxy with a login, optionally with the local Tor hop first — and the pool rotates between entries and rests one that keeps failing. Package tracking, the price feed, the product import, push, the bots, the address lookup and the AI connections can each be pointed at it from their own settings."
    >
      <div className="aset-fields">
        <div className="form-group">
          <label htmlFor="proxy-rotation">Rotation</label>
          <select id="proxy-rotation" className="glass-input" value={pool.rotation} onChange={(e) => setPool((p) => ({ ...p, rotation: e.target.value }))} disabled={!canEdit}>
            {ROTATIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <p className="setting-row-hint">A proxy that fails is rested — one minute, then two, then four, up to an hour — and tried again. A success clears the rest. If every proxy is resting, the least recently failed one is tried anyway, so a pool where everything is refusing reports a fresh failure instead of going quiet.</p>
        </div>

        <div className="pxy-list">
          {pool.proxies.length === 0 && (
            <p className="setting-row-hint">No proxies yet. Add one to build a route, or leave the pool empty and let tracking use Tor or dial directly.</p>
          )}
          {pool.proxies.map((p) => {
            const h = healthFor(p.id);
            const t = testResult[p.id];
            return (
              <div key={p.id} className={`pxy${p.enabled === false ? ' is-off' : ''}`}>
                <div className="pxy-head">
                  <input className="glass-input" value={p.label || ''} onChange={(e) => patchProxy(p.id, { label: e.target.value })} placeholder="Label — e.g. home line" maxLength={48} aria-label="Proxy label" disabled={!canEdit} />
                  <label className="switch" title={p.enabled === false ? 'Disabled — not in the rotation' : 'Enabled'}>
                    <input type="checkbox" checked={p.enabled !== false} onChange={(e) => patchProxy(p.id, { enabled: e.target.checked })} disabled={!canEdit} />
                    <span className="switch-track" />
                  </label>
                  {h && (
                    <span className="pxy-health">
                      <span className={h.ok_count ? 'is-ok' : ''}>{h.ok_count} ok</span>
                      <span className={h.fail_count ? 'is-bad' : ''}>{h.fail_count} failed</span>
                      {h.last_ok_at && <span>last ok {fmtAgo(h.last_ok_at)}</span>}
                      {h.cooling_down_for_ms > 0 && <span className="is-bad">resting {Math.ceil(h.cooling_down_for_ms / 60000)} min</span>}
                      {h.last_error && <span className="is-bad" title={h.last_error}>· {h.last_error.slice(0, 60)}{h.last_error.length > 60 ? '…' : ''}</span>}
                    </span>
                  )}
                </div>

                <div className="pxy-hops">
                  {p.hops.map((hop, i) => (
                    <div key={i} className={`pxy-hop${hop.protocol === 'tor' ? ' is-tor' : ''}`}>
                      <span className="pxy-hop-n">{i + 1}.</span>
                      <select className="glass-input" value={hop.protocol} onChange={(e) => patchHop(p.id, i, { protocol: e.target.value })} aria-label={`Hop ${i + 1} protocol`} disabled={!canEdit}>
                        {PROTOCOLS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                      {hop.protocol === 'tor' ? (
                        <span className="pxy-hop-tor"><Network size={12} aria-hidden="true" /> the address under Tor proxy above</span>
                      ) : (
                        <>
                          <input className="glass-input" value={hop.host || ''} onChange={(e) => patchHop(p.id, i, { host: e.target.value })} placeholder="host or IP" aria-label={`Hop ${i + 1} host`} disabled={!canEdit} />
                          <input className="glass-input" type="number" min="1" max="65535" value={hop.port ?? ''} onChange={(e) => patchHop(p.id, i, { port: e.target.value })} placeholder="port" aria-label={`Hop ${i + 1} port`} disabled={!canEdit} />
                          <input className="glass-input" value={hop.username || ''} onChange={(e) => patchHop(p.id, i, { username: e.target.value })} placeholder="username (optional)" autoComplete="off" aria-label={`Hop ${i + 1} username`} disabled={!canEdit} />
                          <input
                            className="glass-input"
                            type="password"
                            value={hop.password || ''}
                            onChange={(e) => patchHop(p.id, i, { password: e.target.value, has_password: hop.has_password && !e.target.value ? hop.has_password : false })}
                            placeholder={hop.has_password && !hop.password ? (hop.moved ? 'password lost by move — retype' : 'set — leave to keep') : 'password (optional)'}
                            autoComplete="new-password"
                            aria-label={`Hop ${i + 1} password`}
                            disabled={!canEdit}
                          />
                        </>
                      )}
                      <span style={{ display: 'inline-flex', gap: 'var(--sp-05)' }}>
                        <button type="button" className="glass-btn glass-btn-sm" onClick={() => moveHop(p.id, i, -1)} disabled={!canEdit || i === 0} title="Move this hop earlier" aria-label="Move hop up"><ArrowUp size={12} /></button>
                        <button type="button" className="glass-btn glass-btn-sm" onClick={() => moveHop(p.id, i, 1)} disabled={!canEdit || i === p.hops.length - 1} title="Move this hop later" aria-label="Move hop down"><ArrowDown size={12} /></button>
                        <button type="button" className="glass-btn glass-btn-sm" onClick={() => patchProxy(p.id, { hops: p.hops.filter((_, j) => j !== i) })} disabled={!canEdit || p.hops.length === 1} title="Remove this hop" aria-label="Remove hop"><Trash2 size={12} /></button>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="pxy-actions">
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => patchProxy(p.id, { hops: [...p.hops, newHop()] })} disabled={!canEdit || p.hops.length >= 4}><Plus size={12} aria-hidden="true" /> Add a hop</button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => test(p.id)} disabled={testing === p.id || !h} title={h ? 'Dial the saved chain end to end and hang up' : 'Save first — the test dials what is stored'}>
                    <PlugZap size={12} aria-hidden="true" /> {testing === p.id ? 'Dialling…' : 'Test'}
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm glass-btn-danger" onClick={() => removeProxy(p.id)} disabled={!canEdit}><Trash2 size={12} aria-hidden="true" /> Remove</button>
                  {t && (
                    <span className={`pxy-test ${t.ok ? 'is-ok' : 'is-bad'}`}>
                      {t.ok ? <CircleCheck size={12} aria-hidden="true" /> : <CircleX size={12} aria-hidden="true" />}
                      {' '}{t.ok ? `reached ${t.route ? `via ${t.route} ` : ''}in ${t.latencyMs} ms` : t.error}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" className="glass-btn" onClick={addProxy} disabled={!canEdit || pool.proxies.length >= 32}><Plus size={14} aria-hidden="true" /> Add a proxy</button>
          {unsaved && <span className="setting-row-hint" style={{ margin: 0 }}>Save to make new proxies testable.</span>}
        </div>
        <p className="setting-row-hint" style={{ marginTop: 'var(--sp-3)' }}>
          Private and loopback addresses are allowed — a local Tor, a port forwarded over SSH, a container on the compose network are the usual shapes. Link-local addresses are refused. Hostnames are resolved by the last proxy in the chain, never by this server, so a route that ends on Tor can reach .onion hosts and no lookup for the destination ever leaves this box.
        </p>
      </div>
    </SettingsSection>
  );
}
