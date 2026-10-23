import ProgressBar from '../../components/ProgressBar';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import toast from 'react-hot-toast';
import {
  Server, Lock, Unlock, RefreshCw, Wifi, WifiOff, Globe, AlertTriangle,
  Power, Save, ShieldCheck, Coins, Terminal, ChevronDown, ChevronRight, Wallet,
  Link2, Blocks, CheckCircle2, Activity,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import NextStops from '../../components/admin/NextStops';

const REFRESH_MS = 30000;

const COIN_HELP = {
  btc: 'Bitcoin Core with an RPC user/password and a loaded wallet.',
  ltc: 'Litecoin Core with an RPC user/password and a loaded wallet.',
  xmr: 'monero-wallet-rpc. Authentication is HTTP digest, set with --rpc-login.',
};

const label = { fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', display: 'block', marginBottom: 'var(--sp-1)' };
const sectionHead = {
  fontSize: 'var(--fs-xs)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
  color: 'var(--text-secondary)', marginBottom: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)',
};
const divider = { borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)', marginTop: 'var(--sp-3)' };

function pct(progress, places = 2) {
  if (progress === null || progress === undefined) return '—';
  return `${(Math.min(progress, 1) * 100).toFixed(places)}%`;
}

function num(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toLocaleString();
}

/** Bytes as the largest unit that keeps the number short. */
function bytes(value) {
  if (!value && value !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Number(value);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Compact "how long ago", from a unix timestamp in seconds. */
function since(unixSeconds) {
  if (!unixSeconds) return '—';
  const secs = Math.floor(Date.now() / 1000) - Number(unixSeconds);
  if (secs < 0) return 'just now';
  if (secs < 90) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 90) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Rough catch-up estimate from the backlog, at mainnet block times. */
function estimateCatchUp(coin, behind) {
  if (!behind || behind <= 0) return null;
  const minutesPerBlock = { btc: 10, ltc: 2.5, xmr: 2 }[coin] || 10;
  // Nodes replay history far faster than it was produced; this is a floor, and
  // is labelled as an estimate in the UI rather than presented as a countdown.
  const minutes = (behind * minutesPerBlock) / 60;
  if (minutes < 60) return `~${Math.max(1, Math.round(minutes))}m of chain left`;
  const hours = minutes / 60;
  if (hours < 48) return `~${Math.round(hours)}h of chain left`;
  return `~${Math.round(hours / 24)}d of chain left`;
}

/**
 * Unlocks are taken for the daemon maximum, so the expiry is years away and a
 * countdown would be noise. Only show a real deadline if one is near.
 */
function describeUnlock(unlockedUntil) {
  if (!unlockedUntil) return 'Unlocked';
  const left = unlockedUntil - Math.floor(Date.now() / 1000);
  if (left <= 0) return 'Unlocked';
  if (left > 86400) return 'Unlocked — stays open until locked or the daemon restarts';
  const m = Math.floor(left / 60);
  const sec = left % 60;
  return `Unlocked — re-locks in ${m > 0 ? `${m}m ${sec}s` : `${sec}s`}`;
}

/** "3 min ago" / "2 h ago" / "4 d ago" for the sweep's timestamp. */
function sinceLabel(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/**
 * What the sweep last did, from the record it keeps for exactly this reader.
 *
 * Three states and three colours, no glow: failed is the one to act on (a
 * wallet that re-locked itself after a daemon restart is the usual cause, and
 * the message says so), waiting is the checker retrying on its tick, and a
 * plain success names the transaction.
 */
function WithdrawState({ state }) {
  if (!state) return null;
  const failed = state.ok === false;
  const waiting = !failed && state.deferred;
  const tone = failed ? 'var(--danger)' : waiting ? 'var(--warning)' : 'var(--success)';
  const Icon = failed ? AlertTriangle : waiting ? Activity : CheckCircle2;
  const head = failed ? 'Last sweep failed' : waiting ? 'Waiting' : 'Last sweep';
  return (
    <p style={{ fontSize: 'var(--fs-xs)', color: tone, margin: 'var(--sp-15) 0 0', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-1)', wordBreak: 'break-word' }}>
      <Icon size={11} style={{ flexShrink: 0, marginTop: '0.15em' }} />
      <span>
        <strong style={{ fontWeight: 600 }}>{head}</strong>
        {state.at && <span style={{ color: 'var(--text-muted)' }}> · {sinceLabel(state.at)}</span>}
        {state.message && <span style={{ display: 'block', color: failed ? tone : 'var(--text-secondary)' }}>{state.message}</span>}
      </span>
    </p>
  );
}

/** A value pinned by an environment variable cannot be changed from here. */
function EnvNote({ variable }) {
  if (!variable) return null;
  return (
    <span style={{ fontSize: 'var(--fs-3xs)', color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
      <Terminal size={9} /> set by {variable}
    </span>
  );
}

function Field({ id, spec, value, onChange, disabled, type = 'text', placeholder, hint, children }) {
  const envLocked = !!spec?.env;
  return (
    <div>
      <label htmlFor={id} style={{ ...label, display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', flexWrap: 'wrap' }}>
        {children}
        <EnvNote variable={spec?.env} />
      </label>
      <input
        id={id}
        className="glass-input"
        type={type}
        value={value}
        // `new-password` on the secrets, not `off`: browsers ignore `off` on a
        // password input, which is how an RPC password field ended up being
        // offered the operator's own store login.
        autoComplete={type === 'password' ? 'new-password' : 'off'}
        disabled={disabled || envLocked}
        onChange={(e) => onChange(e.target.value)}
        placeholder={envLocked ? '(from environment)' : placeholder}
        style={{ margin: 0, opacity: envLocked ? 0.55 : 1 }}
      />
      {hint && <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.2rem 0 0' }}>{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange, disabled, accent, spec, children, hint }) {
  // A value pinned by the environment cannot be changed from here, and letting
  // the control move anyway would report a change that never takes effect.
  const envLocked = !!spec?.env;
  const locked = disabled || envLocked;
  return (
    <div>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-sm)', flexWrap: 'wrap',
        cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.55 : 1,
      }}>
        <input
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={(e) => onChange(e.target.checked)}
          style={{ accentColor: accent || 'var(--primary)' }}
        />
        {children}
        <EnvNote variable={spec?.env} />
      </label>
      {hint && <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.2rem 0 0 1.4rem' }}>{hint}</p>}
    </div>
  );
}

function UnlockForm({ coin, coinLabel, onDone }) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!passphrase) return toast.error('Passphrase is required');
    setBusy(true);
    try {
      // No duration: the server unlocks for the longest the daemon accepts.
      await api.post(`/admin/wallet/${coin}/unlock`, { passphrase });
      setPassphrase('');
      toast.success(`${coinLabel} wallet unlocked`);
      onDone();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--sp-25)' }}>
      <input
        className="glass-input"
        type="password"
        autoComplete="new-password"
        value={passphrase}
        onChange={(e) => setPassphrase(e.target.value)}
        placeholder="Wallet passphrase"
        style={{ margin: 0, flex: '1 1 200px' }}
      />
      <button className="glass-btn glass-btn-sm" disabled={busy} style={{ fontSize: 'var(--fs-xs)' }}>
        <Unlock size={12} /> {busy ? 'Unlocking…' : 'Unlock'}
      </button>
    </form>
  );
}

/**
 * Monero has no passphrase lock. The closest equivalent is closing the wallet
 * file, which also stops payment detection — so it is presented as its own
 * action rather than as a "lock".
 */
function MoneroWalletControls({ node, onRefresh, canManage }) {
  const [busy, setBusy] = useState(false);

  const act = async (action) => {
    if (action === 'close' && !confirm(
      'Close the Monero wallet?\n\nThis stops spending AND payment detection: no new subaddresses '
      + 'and no incoming payments will be seen until it is reopened.\n\n'
      + 'Reopening only works if monero-wallet-rpc was started with --wallet-dir. With the usual '
      + '--wallet-file setup you must restart the service to get the wallet back.'
    )) return;
    setBusy(true);
    try {
      await api.post(`/admin/wallet/xmr/${action}`);
      toast.success(action === 'close' ? 'Monero wallet closed' : 'Monero wallet opened');
      onRefresh();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  if (!node.walletOpen) {
    return (
      <div>
        <p style={{ fontSize: 'var(--fs-sm)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <Lock size={13} /> Wallet closed — payments are not being detected
        </p>
        {canManage ? (
          <button className="glass-btn glass-btn-sm" onClick={() => act('open')} disabled={busy}
            style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-2)' }}>
            <Power size={12} /> {busy ? 'Opening…' : 'Open wallet'}
          </button>
        ) : (
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
            Reopening the wallet needs the “Open and close wallets” permission.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0 }}>
        Open and spend-capable — Monero’s wallet RPC has no passphrase lock.
      </p>
      {canManage && node.canReopen && (
        <button className="glass-btn glass-btn-sm" onClick={() => act('close')} disabled={busy}
          style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-2)' }}>
          <Power size={12} /> {busy ? 'Closing…' : 'Close wallet'}
        </button>
      )}
      {canManage && !node.canReopen && (
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
          Closing is disabled: this wallet cannot be reopened over RPC (no wallet password set, or
          monero-wallet-rpc was started with --wallet-file). Restart the service to change wallet state.
        </p>
      )}
    </div>
  );
}

function WalletSection({ node, coinLabel, onRefresh, can }) {
  const [locking, setLocking] = useState(false);

  const lockNow = async () => {
    setLocking(true);
    try {
      await api.post(`/admin/wallet/${node.coin}/lock`);
      toast.success(`${coinLabel} wallet locked`);
      onRefresh();
    } catch (err) {
      toast.error(err.message);
    }
    setLocking(false);
  };

  if (node.lock?.error) {
    return <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)', margin: 0 }}>Wallet: {node.lock.error}</p>;
  }
  if (!node.lock?.supported) {
    return <MoneroWalletControls node={node} onRefresh={onRefresh} canManage={can.manageWallets} />;
  }
  if (!node.lock.encrypted) {
    return (
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning, #e0a800)', margin: 0 }}>
        Wallet is not encrypted — anyone with RPC access can spend from it.
      </p>
    );
  }

  const keypoolLow = node.lock.keypool?.exhaustible && node.lock.locked
    && node.lock.keypool.size !== null && node.lock.keypool.size <= 100;

  if (keypoolLow) {
    return (
      <>
        <p style={{ fontSize: 'var(--fs-sm)', margin: 0, color: 'var(--warning, #e0a800)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <AlertTriangle size={13} /> Keypool low: {node.lock.keypool.size} addresses left
        </p>
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
          This wallet cannot refill its keypool while locked. When it empties, new payment
          addresses fail with “Keypool ran out”. Unlock once to refill it.
        </p>
        {can.unlockWallets
          ? <UnlockForm coin={node.coin} coinLabel={coinLabel} onDone={onRefresh} />
          : <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>Unlocking needs the “Unlock and lock wallets” permission.</p>}
      </>
    );
  }

  if (node.lock.locked) {
    return (
      <>
        <p style={{ fontSize: 'var(--fs-sm)', margin: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <Lock size={13} /> Locked — sends will be rejected
        </p>
        {can.unlockWallets
          ? <UnlockForm coin={node.coin} coinLabel={coinLabel} onDone={onRefresh} />
          : <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>Unlocking needs the “Unlock and lock wallets” permission.</p>}
      </>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-25)', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
        <Unlock size={13} /> {describeUnlock(node.lock.unlockedUntil)}
      </span>
      {can.unlockWallets && (
        <button className="glass-btn glass-btn-sm" onClick={lockNow} disabled={locking} style={{ fontSize: 'var(--fs-xs)' }}>
          <Lock size={12} /> {locking ? 'Locking…' : 'Lock now'}
        </button>
      )}
    </div>
  );
}

function Stat({ label: statLabel, value, title }) {
  return (
    <div>
      <div className="node-stat-label">{statLabel}</div>
      <div className="node-stat-value" title={title || (typeof value === 'string' ? value : undefined)}>{value}</div>
    </div>
  );
}

/**
 * Chain sync for one coin.
 *
 * The progress figure alone is a poor summary: a node at 99.99% can still be
 * thousands of blocks behind, and one that has stopped receiving blocks looks
 * identical to one that is perfectly caught up. Height, backlog and the age of
 * the tip are what actually answer "can this node take a payment right now".
 */
function ChainSync({ coin, chain, peers, version, latencyMs }) {
  if (!chain) return null;

  const synced = chain.synced;
  const behind = chain.behind ?? Math.max((chain.headers || 0) - (chain.blocks || 0), 0);
  // Bitcoin Core reports 0 headers while pre-synchronising them, so there is no
  // denominator yet and a percentage would be a fabrication.
  const indeterminate = !synced && (!chain.headers || chain.headers === 0);
  const estimate = estimateCatchUp(coin, behind);

  // A tip older than a few block intervals means the node has stopped following
  // the chain even though it still answers RPC.
  const stallMinutes = { btc: 90, ltc: 30, xmr: 25 }[coin] || 90;
  const stale = Boolean(synced && chain.lastBlockTime
    && (Date.now() / 1000 - chain.lastBlockTime) > stallMinutes * 60);

  return (
    <div className="node-sync" style={{ marginTop: 'var(--sp-3)' }}>
      <div className="node-sync-head">
        <span
          className="node-sync-state"
          style={{ color: synced ? 'var(--success)' : 'var(--primary)' }}
        >
          {synced ? <CheckCircle2 size={13} /> : <Activity size={13} />}
          {synced ? 'Synced' : indeterminate ? 'Preparing headers' : 'Syncing'}
        </span>
        <span className="node-sync-pct" style={{ color: synced ? 'var(--success)' : 'var(--text)' }}>
          {indeterminate ? '—' : pct(chain.progress, synced ? 2 : 3)}
        </span>
      </div>

      <div className="sync-bar">
        <div
          className={`sync-bar-fill${synced ? ' is-synced' : ' is-syncing'}${indeterminate ? ' sync-bar-indeterminate' : ''}`}
          style={indeterminate ? undefined : { width: pct(chain.progress) }}
          role="progressbar"
          aria-valuenow={indeterminate ? undefined : Math.round((chain.progress || 0) * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${coin.toUpperCase()} chain sync`}
        />
      </div>

      <div className="node-stats">
        <Stat label="Height" value={num(chain.blocks)} />
        <Stat label="Tip" value={num(chain.headers)} title="Best header height the node knows about" />
        <Stat
          label="Behind"
          value={behind > 0 ? num(behind) : '0'}
          title={estimate || 'Caught up with the tip'}
        />
        {peers !== null && peers !== undefined ? <Stat label="Peers" value={num(peers)} /> : null}
        {chain.mempool !== null && chain.mempool !== undefined && (
          <Stat label="Mempool" value={num(chain.mempool)} title="Unconfirmed transactions the node is holding" />
        )}
        {chain.lastBlockTime ? <Stat label="Last block" value={since(chain.lastBlockTime)} /> : null}
        {chain.name ? <Stat label="Network" value={chain.name} /> : null}
        {chain.sizeOnDisk ? <Stat label="On disk" value={bytes(chain.sizeOnDisk)} /> : null}
        {latencyMs !== null && latencyMs !== undefined && (
          <Stat label="RPC" value={`${num(latencyMs)} ms`} title="Round trip for this status check" />
        )}
      </div>

      {version ? (
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>{version}</p>
      ) : null}

      {chain.pruned && (
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.4rem 0 0' }}>
          Pruned node — historical blocks are discarded. Receiving and confirming payments still works.
        </p>
      )}

      {indeterminate && (
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.4rem 0 0' }}>
          Header pre-synchronization is running; there is no target height to measure against yet.
        </p>
      )}

      {!synced && !indeterminate && (
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warning)', margin: '0.4rem 0 0', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-1)' }}>
          <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
          {num(behind)} blocks behind{estimate ? ` (${estimate})` : ''}. Payments to this coin may be
          detected late until it catches up.
        </p>
      )}

      {stale && (
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warning)', margin: '0.4rem 0 0', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-1)' }}>
          <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
          The node reports it is synced but its newest block is {since(chain.lastBlockTime)} — check that it
          still has peers.
        </p>
      )}
    </div>
  );
}

function StatusBlock({ node }) {
  if (!node) return null;
  if (!node.enabled) {
    return (
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
        RPC is switched off, so this node is not being contacted.
      </p>
    );
  }

  if (!node.connected) {
    return (
      <div style={{ marginTop: 'var(--sp-25)' }}>
        {node.error && (
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)', margin: 0, lineHeight: 1.55 }}>{node.error}</p>
        )}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 'var(--sp-25)' }}>
      <ChainSync
        coin={node.coin}
        chain={node.chain}
        peers={node.peers}
        version={node.version}
        latencyMs={node.latencyMs}
      />

      {/* Monero's wallet scans the chain on its own schedule, so a synced daemon
          does not imply the wallet has seen recent payments. */}
      {node.coin === 'xmr' && node.walletSync && !node.walletSync.caughtUp && (
        <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warning)', margin: '0.5rem 0 0', display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-1)' }}>
          <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 'var(--sp-05)' }} />
          The wallet has scanned to block {num(node.walletSync.height)} — {num(node.walletSync.behind)} behind
          the daemon. Recent payments will not be seen until it catches up.
        </p>
      )}

      {node.coin === 'xmr' && !node.chain && (
        <div className="node-sync" style={{ marginTop: 'var(--sp-3)' }}>
          <div className="node-sync-head" style={{ marginBottom: 0 }}>
            <span className="node-sync-state" style={{ color: 'var(--text-muted)' }}>
              <Blocks size={13} /> Chain sync unavailable
            </span>
            <span className="node-sync-pct" style={{ color: 'var(--text-muted)' }}>
              {node.walletHeight ? num(node.walletHeight) : '—'}
            </span>
          </div>
          <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: '0.45rem 0 0', lineHeight: 1.55 }}>
            {node.daemon?.configured
              ? <>The Monero daemon is configured but not answering{node.daemon.error ? `: ${node.daemon.error}` : '.'}</>
              : <>That number is the wallet’s own scan height, not the chain’s. Add the monerod
                  restricted RPC under Connection below to show real chain sync.</>}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Health of the shared Tor SOCKS proxy.
 *
 * Every onion-routed node depends on this one process. When it is down all
 * three cards say "unreachable" with an error naming 127.0.0.1, which reads as
 * a node problem — so the real cause gets its own banner above them.
 */
function TorProxyBanner({ status, onRetry }) {
  if (!status) return null;
  const {
    ok, host, port, source, portSource, error, hint, latencyMs, dependents = [],
  } = status;

  if (ok) {
    if (dependents.length === 0) return null;
    return (
      <div className="node-alert node-alert-ok">
        <Globe size={16} style={{ color: 'var(--success)', flexShrink: 0, marginTop: 'var(--sp-05)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="node-alert-title" style={{ color: 'var(--success)' }}>Tor proxy reachable</div>
          <div className="node-alert-body">
            <code>{host}:{port}</code> answered in {num(latencyMs)} ms.
            {' '}Routing {dependents.join(', ')} through it.
          </div>
        </div>
      </div>
    );
  }

  const labelFor = (s) => (s === 'env'
    ? 'the TOR_HOST / TOR_PORT environment variables'
    : s === 'settings'
      ? 'Settings → Tor proxy'
      : 'the built-in default');

  const sourceLabel = labelFor(source);
  // `source` describes the host/port pair, so it reads "env" even when only
  // TOR_HOST was set and the port fell through to the built-in default. That
  // combination is precisely the one the 9050 → 9150 default move breaks, and
  // telling that operator the port "comes from the environment variables"
  // sends them to edit a value that is not there. Name the port's own origin
  // whenever it differs from the pair's.
  const portSourceDiffers = portSource && portSource !== source;

  return (
    <div className="node-alert">
      <AlertTriangle size={16} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 'var(--sp-05)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="node-alert-title" style={{ color: 'var(--danger)' }}>
          Tor proxy is not reachable
        </div>
        <div className="node-alert-body">
          {error || `Could not connect to ${host}:${port}.`}
          {dependents.length > 0 && (
            <> Nothing routed through Tor can work until this is fixed, which right now
              means {dependents.join(', ')} — those cards will keep showing “unreachable”
              even when the nodes themselves are healthy.</>
          )}
          <br />
          The address <code>{host}:{port}</code> comes from {sourceLabel}
          {portSourceDiffers && <> — the port itself from {labelFor(portSource)}</>}.
          {' '}Start your Tor client, or point the store at the port it is actually listening on
          (Arti uses <code>9150</code>; the older C tor daemon uses <code>9050</code>).
          {hint && (
            // The probe found a Tor client on the *other* implementation's
            // default port. That is the upgrade case — C tor on 9050 while the
            // store now dials Arti on 9150 — and it is the one failure here
            // with a one-line fix, so it gets its own block rather than being
            // appended to a paragraph an operator has already skimmed.
            <div style={{
              marginTop: 'var(--sp-2)', padding: 'var(--sp-2) var(--sp-25)',
              border: '1px solid var(--border)', borderRadius: '0.4rem',
              background: 'var(--surface)',
            }}>
              {hint}
            </div>
          )}
        </div>
        <button className="glass-btn glass-btn-sm" onClick={onRetry} style={{ fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-25)' }}>
          <RefreshCw size={11} /> Re-check
        </button>
      </div>
    </div>
  );
}

function NodeCard({ config, status, can, onSaved, onRefresh }) {
  const { coin, label: coinLabel, symbol, software, authScheme, defaultPort, fields, torForced, autoWithdrawState } = config;

  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState(null);

  // Server values are the source of truth; the draft only holds edits, so a
  // background status refresh never clobbers something being typed.
  const valueOf = useCallback((name) => {
    if (name in draft) return draft[name];
    const spec = fields[name];
    if (!spec) return '';
    return spec.secret ? '' : (spec.value ?? '');
  }, [draft, fields]);

  const boolOf = useCallback((name) => valueOf(name) === 'true' || valueOf(name) === true, [valueOf]);
  const set = (name, value) => setDraft((d) => ({ ...d, [name]: value }));
  const setBool = (name, value) => set(name, value ? 'true' : 'false');
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const res = await api.put(`/admin/nodes/config/${coin}`, draft);
      setDraft({});
      toast.success(res.message || 'Saved');
      onSaved(res.node);
    } catch (err) {
      toast.error(err.message);
    }
    setSaving(false);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.post(`/admin/nodes/test/${coin}`, {}));
    } catch (err) {
      setTestResult({ connected: false, error: err.message });
    }
    setTesting(false);
  };

  const fetchBalance = async () => {
    try {
      setBalance(await api.get(`/admin/wallet/${coin}/balance`));
    } catch (err) {
      setBalance({ error: err.message });
    }
  };

  const rpcOn = boolOf('rpc_enabled');
  const paymentsOn = boolOf('payments_enabled');
  const usingTor = torForced || boolOf('use_tor');
  const connected = status?.connected;

  return (
    // `data-search-target` is what the admin nav search glows when it sends
    // somebody here. It sits on the CARD rather than only on the fields inside
    // because most of those fields render conditionally — the Monero daemon
    // block only exists once XMR RPC is on, so a search result pointing
    // straight at `xmr-daemon-host` finds nothing on a store that has not
    // enabled the coin yet, which is exactly the store whose operator is
    // looking for it. The card is always here; see the `fallback` field in
    // utils/adminSearchIndex.
    <div className="glass-card" data-search-target={`nodes-${coin}`} style={{ padding: 'var(--sp-4)' }}>
      {/* Header: identity + live status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-md)' }}>{coinLabel} <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 'var(--fs-sm)' }}>{symbol}</span></h3>
        {rpcOn && (connected
          ? (
            <span style={{ color: 'var(--success)', fontSize: 'var(--fs-xs)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
              <Wifi size={12} /> connected
              {status?.chain && !status.chain.synced && (
                <span style={{ color: 'var(--warning)' }}>· syncing</span>
              )}
            </span>
          )
          : <span style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}><WifiOff size={12} /> unreachable</span>)}
        {usingTor && (
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
            <Globe size={11} /> via Tor
          </span>
        )}
        {paymentsOn && (
          <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-1)', marginLeft: 'auto' }}>
            <Coins size={11} /> accepted at checkout
          </span>
        )}
      </div>

      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '0.3rem 0 0', wordBreak: 'break-all' }}>
        {fields.host?.effective || fields.host?.value || '—'}:{fields.port?.effective || fields.port?.value || defaultPort} · {software}
      </p>

      <StatusBlock node={status} />

      {/* Checkout availability */}
      <div style={divider}>
        <div style={sectionHead}><Coins size={12} /> Payments</div>
        <Toggle
          checked={paymentsOn}
          disabled={!can.configureNodes}
          onChange={(v) => setBool('payments_enabled', v)}
          hint={`Shows ${symbol} as a payment option at checkout. Payment addresses come from this node, so the node must be enabled and reachable.`}
        >
          Accept {coinLabel} at checkout
        </Toggle>
        {paymentsOn && !rpcOn && (
          <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', margin: '0.4rem 0 0', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
            <AlertTriangle size={11} /> The node is disabled — checkout will fail for {symbol} until it is turned on.
          </p>
        )}
        <div style={{ marginTop: 'var(--sp-2)' }}>
          <Toggle
            checked={boolOf('testnet')}
            disabled={!can.configureNodes}
            accent="var(--warning)"
            onChange={(v) => setBool('testnet', v)}
            hint="Marks payments as testnet in the UI. Only takes effect while developer mode is on."
          >
            Testnet
          </Toggle>
        </div>
      </div>

      {/* Connection */}
      <div style={divider}>
        <button
          onClick={() => setOpen((v) => !v)}
          className="glass-btn glass-btn-sm"
          style={{ ...sectionHead, marginBottom: 0, background: 'none', border: 'none', padding: 0, cursor: 'pointer', width: '100%', justifyContent: 'flex-start' }}
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Server size={12} /> Connection
          {/* `whiteSpace: normal`: the button is a `.glass-btn`, which does not wrap,
              and this hint is wider than a 320px phone's card. */}
          <span style={{ marginLeft: 'auto', minWidth: 0, whiteSpace: 'normal', textAlign: 'right', fontSize: 'var(--fs-2xs)', fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>
            {open ? 'hide' : 'edit address, port and credentials'}
          </span>
        </button>

        {open && (
          <div style={{ marginTop: 'var(--sp-3)', display: 'grid', gap: 'var(--sp-25)' }}>
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0 }}>{COIN_HELP[coin]}</p>

            <Toggle
              checked={rpcOn}
              spec={fields.rpc_enabled}
              disabled={!can.configureNodes}
              onChange={(v) => setBool('rpc_enabled', v)}
              hint="When off, the store never contacts this node and cannot generate payment addresses for it."
            >
              Node enabled
            </Toggle>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--sp-2)' }}>
              <Field id={`${coin}-host`} spec={fields.host} value={valueOf('host')} disabled={!can.configureNodes}
                onChange={(v) => set('host', v)} placeholder="127.0.0.1 or abc…onion">
                Address / IP
              </Field>
              <Field id={`${coin}-port`} spec={fields.port} value={valueOf('port')} disabled={!can.configureNodes}
                onChange={(v) => set('port', v)} placeholder={defaultPort}>
                Port
              </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)' }}>
              <Field id={`${coin}-user`} spec={fields.user} value={valueOf('user')} disabled={!can.configureNodes}
                onChange={(v) => set('user', v)}
                placeholder={fields.user?.configured ? '(configured — leave blank to keep)' : 'rpcuser'}>
                RPC username
              </Field>
              <Field id={`${coin}-pass`} spec={fields.pass} type="password" value={valueOf('pass')} disabled={!can.configureNodes}
                onChange={(v) => set('pass', v)}
                placeholder={fields.pass?.configured ? '•••••••• (leave blank to keep)' : 'rpcpassword'}>
                RPC password
              </Field>
            </div>
            <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', margin: 0 }}>
              {authScheme === 'digest'
                ? 'Monero authenticates with HTTP digest; these must match --rpc-login.'
                : 'These must match rpcuser / rpcpassword (or rpcauth) on the node.'}
              {' '}Credentials are stored write-only and never sent back to this page.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)' }}>
              <Field id={`${coin}-wallet`} spec={fields.wallet} value={valueOf('wallet')} disabled={!can.configureNodes}
                onChange={(v) => set('wallet', v)} placeholder="wallet">
                Wallet name
              </Field>
              <Field id={`${coin}-timeout`} spec={fields.timeout_ms} value={valueOf('timeout_ms')} disabled={!can.configureNodes}
                onChange={(v) => set('timeout_ms', v)} placeholder={usingTor ? '120000' : '15000'}
                hint={usingTor
                  ? 'Blank uses the default. Over Tor 120000 is a floor — a smaller value is raised to it.'
                  : 'Blank uses the default — longer over Tor.'}>
                Timeout (ms)
              </Field>
            </div>

            {coin === 'xmr' && (
              <Field id="xmr-wallet-password" spec={fields.wallet_password} type="password"
                value={valueOf('wallet_password')} disabled={!can.configureNodes}
                onChange={(v) => set('wallet_password', v)}
                placeholder={fields.wallet_password?.configured ? '•••••••• (leave blank to keep)' : '(none)'}
                hint="Only needed to reopen the wallet file over RPC after closing it.">
                Wallet file password
              </Field>
            )}

            <Toggle
              checked={usingTor}
              spec={torForced ? undefined : fields.use_tor}
              disabled={!can.configureNodes || torForced}
              onChange={(v) => setBool('use_tor', v)}
              hint={torForced
                ? 'Forced on: an .onion address has no DNS, so it is only reachable through the proxy.'
                : 'Route this node through the Tor SOCKS proxy. Needed for .onion hosts, optional for a remote clearnet node.'}
            >
              Reach this node through Tor
            </Toggle>

            {coin === 'xmr' && (
              <div style={{ ...divider, marginTop: 'var(--sp-15)' }}>
                <div style={sectionHead}><Server size={12} /> Monero daemon (optional)</div>
                <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '0 0 0.5rem' }}>
                  The wallet RPC only knows its own height. Point this at monerod’s restricted RPC to
                  show real chain sync above. Payments work without it.
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--sp-2)' }}>
                  <Field id="xmr-daemon-host" spec={fields.daemon_host} value={valueOf('daemon_host')} disabled={!can.configureNodes}
                    onChange={(v) => set('daemon_host', v)} placeholder="leave blank to disable">
                    Daemon address
                  </Field>
                  <Field id="xmr-daemon-port" spec={fields.daemon_port} value={valueOf('daemon_port')} disabled={!can.configureNodes}
                    onChange={(v) => set('daemon_port', v)} placeholder="18089">
                    Port
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                  <Field id="xmr-daemon-user" spec={fields.daemon_user} value={valueOf('daemon_user')} disabled={!can.configureNodes}
                    onChange={(v) => set('daemon_user', v)}
                    placeholder={fields.daemon_user?.configured ? '(configured)' : 'optional'}>
                    Daemon username
                  </Field>
                  <Field id="xmr-daemon-pass" spec={fields.daemon_pass} type="password" value={valueOf('daemon_pass')} disabled={!can.configureNodes}
                    onChange={(v) => set('daemon_pass', v)}
                    placeholder={fields.daemon_pass?.configured ? '••••••••' : 'optional'}>
                    Daemon password
                  </Field>
                </div>
                <div style={{ marginTop: 'var(--sp-2)' }}>
                  <Toggle
                    checked={boolOf('daemon_use_tor')}
                    spec={fields.daemon_use_tor}
                    disabled={!can.configureNodes}
                    onChange={(v) => setBool('daemon_use_tor', v)}
                  >
                    Reach the daemon through Tor
                  </Toggle>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap', marginTop: 'var(--sp-1)' }}>
              {can.configureNodes && (
                <button className="glass-btn glass-btn-sm" onClick={save} disabled={!dirty || saving} style={{ fontSize: 'var(--fs-xs)' }}>
                  <Save size={12} /> {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
                </button>
              )}
              <button className="glass-btn glass-btn-sm" onClick={test} disabled={testing} style={{ fontSize: 'var(--fs-xs)' }}>
                <Wifi size={12} /> {testing ? 'Testing…' : 'Test connection'}
              </button>
              {dirty && (
                <button className="glass-btn glass-btn-sm" onClick={() => setDraft({})} style={{ fontSize: 'var(--fs-xs)' }}>
                  Discard
                </button>
              )}
              {testResult && (
                <span style={{ fontSize: 'var(--fs-xs)', color: testResult.connected ? 'var(--success)' : 'var(--danger)', flex: '1 1 100%' }}>
                  {testResult.connected
                    ? `✓ Connected${testResult.chain ? ` — ${testResult.chain}, block ${testResult.blocks?.toLocaleString?.() ?? testResult.blocks}` : testResult.version ? ` — v${testResult.version}` : ''}${testResult.latencyMs ? ` (${testResult.latencyMs} ms)` : ''}`
                    : `✗ ${testResult.error}`}
                  {!testResult.connected && testResult.torProxy && (
                    <span style={{ display: 'block', color: 'var(--text-muted)', marginTop: 'var(--sp-1)' }}>
                      {testResult.torProxy.ok
                        ? `The Tor proxy at ${testResult.torProxy.host}:${testResult.torProxy.port} is up, so this is the node or the onion address — not Tor.`
                        : `The Tor proxy at ${testResult.torProxy.host}:${testResult.torProxy.port} is also down — fix that first.`}
                    </span>
                  )}
                </span>
              )}
            </div>
            {dirty && (
              <p style={{ fontSize: 'var(--fs-2xs)', color: 'var(--warning)', margin: 0 }}>
                Unsaved changes — test runs against the saved configuration, not the edits above.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Wallet state */}
      {rpcOn && connected && (
        <div style={divider}>
          <div style={sectionHead}>
            <Wallet size={12} /> Wallet
            {can.viewBalances && (
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', textTransform: 'none', letterSpacing: 0 }}>
                {balance?.error
                  ? <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--danger)', fontWeight: 400 }}>{balance.error}</span>
                  : balance
                    ? <span style={{ fontSize: 'var(--fs-base)', fontWeight: 700, color: 'var(--success)' }}>
                        {typeof balance.balance === 'number' ? balance.balance.toLocaleString('en-US', { maximumFractionDigits: 8 }) : '—'} {balance.unit}
                      </span>
                    : null}
                <button className="glass-btn glass-btn-sm" onClick={fetchBalance} style={{ fontSize: 'var(--fs-2xs)', padding: 'var(--sp-05) var(--sp-15)' }} title="Show balance">
                  <RefreshCw size={10} />
                </button>
              </span>
            )}
          </div>
          <WalletSection node={status} coinLabel={coinLabel} onRefresh={onRefresh} can={can} />
        </div>
      )}

      {/* Auto-withdraw — only rendered when the viewer may move funds.
          The controls are gated on `nodes.send`, the grant the server checks
          for these three fields on either door; `nodes.configure` is not
          needed for them and a treasurer holding only `nodes.send` gets a
          working section, with its own Save below because the Connection
          block's button is theirs only when that block is open. */}
      {can.sendFunds && fields.auto_withdraw_enabled && (
        <div style={divider}>
          <div style={sectionHead}>
            <ShieldCheck size={12} /> Auto-withdraw
          </div>
          <Toggle
            checked={fields.auto_withdraw_enabled?.env ? fields.auto_withdraw_enabled.effective === 'true' : boolOf('auto_withdraw_enabled')}
            spec={fields.auto_withdraw_enabled}
            accent="var(--warning)"
            disabled={!can.sendFunds}
            onChange={(v) => setBool('auto_withdraw_enabled', v)}
            hint="After each confirmed payment, forwards everything at or past the store's deepest required confirmation depth to the address below, and keeps retrying on the payment checker's tick until it has. Monero waits until every spendable output is that deep."
          >
            Forward confirmed payments
          </Toggle>
          <div style={{ display: 'grid', gridTemplateColumns: coin === 'xmr' ? '1fr' : '1fr 140px', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
            <Field id={`${coin}-withdraw-addr`} spec={fields.auto_withdraw_address} value={valueOf('auto_withdraw_address')}
              disabled={!can.sendFunds} onChange={(v) => set('auto_withdraw_address', v)}
              placeholder={`Your ${symbol} address`}>
              Destination address
            </Field>
            {coin !== 'xmr' && (
              <Field id={`${coin}-withdraw-fee`} spec={fields.auto_withdraw_fee_rate} value={valueOf('auto_withdraw_fee_rate')}
                disabled={!can.sendFunds} onChange={(v) => set('auto_withdraw_fee_rate', v)}
                placeholder="node default">
                Fee (sat/vB)
              </Field>
            )}
          </div>
          {boolOf('auto_withdraw_enabled') && !valueOf('auto_withdraw_address') && !fields.auto_withdraw_address?.effective && (
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', marginTop: 'var(--sp-1)', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
              <AlertTriangle size={11} /> Set a destination address — the server refuses to switch forwarding on without one.
            </p>
          )}
          <WithdrawState state={autoWithdrawState} />
          {dirty && Object.keys(draft).some((k) => k.startsWith('auto_withdraw_')) && (
            <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center', flexWrap: 'wrap', marginTop: 'var(--sp-2)' }}>
              <button className="glass-btn glass-btn-sm" onClick={save} disabled={saving} style={{ fontSize: 'var(--fs-xs)' }}>
                <Save size={12} /> {saving ? 'Saving…' : 'Save changes'}
              </button>
              <button className="glass-btn glass-btn-sm" onClick={() => setDraft({})} style={{ fontSize: 'var(--fs-xs)' }}>
                Discard
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminNodes() {
  const { user } = useAuth();
  const can = useMemo(() => adminCapabilities(user), [user]);

  const [configs, setConfigs] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [torProxy, setTorProxy] = useState(null);
  const [torStatus, setTorStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadSteps, setLoadSteps] = useState([]);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await api.get('/admin/nodes/config');
      setConfigs(data.nodes || []);
      setTorProxy(data.torProxy || null);
    } catch (err) {
      toast.error(err.message);
    }
  }, []);

  const fetchStatus = useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    try {
      setStatuses(await api.get('/admin/nodes/status'));
    } catch (err) {
      // A node being unreachable is normal and already reported per card; only
      // an outright failure of the endpoint is worth a toast.
      if (showSpinner) toast.error(err.message);
    }
    if (showSpinner) setRefreshing(false);
  }, []);

  // Probed separately from the nodes: it is one shared dependency, and when it
  // is down it explains every card at once.
  const fetchTorStatus = useCallback(async () => {
    try {
      setTorStatus(await api.get('/admin/nodes/tor-status'));
    } catch {
      setTorStatus(null);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let probing = true;
    const finishStep = (name) => { if (active) setLoadSteps((steps) => [...steps, name]); };
    setLoadSteps([]);
    (async () => {
      await Promise.all([
        fetchConfig().finally(() => finishStep('settings')),
        fetchStatus(true).finally(() => finishStep('nodes')),
        fetchTorStatus().finally(() => finishStep('proxy')),
      ]);
      probing = false;
      if (active) setLoading(false);
    })();
    // Do not pile a second round of probes on top of a slow first one.
    const timer = setInterval(async () => {
      if (probing) return;
      probing = true;
      try { await Promise.all([fetchStatus(), fetchTorStatus()]); }
      finally { probing = false; }
    }, REFRESH_MS);
    return () => { active = false; clearInterval(timer); };
  }, [fetchConfig, fetchStatus, fetchTorStatus]);

  const onSaved = (node) => {
    if (!node) return fetchConfig();
    setConfigs((list) => list.map((c) => (c.coin === node.coin ? node : c)));
    fetchStatus();
  };

  const refreshAll = async () => {
    setRefreshing(true);
    try { await Promise.all([fetchConfig(), fetchStatus(), fetchTorStatus()]); }
    finally { setRefreshing(false); }
  };

  if (loading) {
    return <div className="admin-page">
      <PageHeader icon={Server} title="Nodes" subtitle="Checking node connections…" />
      <ProgressBar className="nodes-progress" label="Loading nodes…" value={loadSteps.length / 3 * 100}
        detail={`${loadSteps.length} of 3 checks finished · ${!loadSteps.includes('settings') ? 'Reading settings' : !loadSteps.includes('proxy') ? 'Checking the Tor proxy' : 'Waiting for node responses'}`} />
    </div>;
  }

  const statusFor = (coin) => statuses.find((s) => s.coin === coin);
  const anyEnvOverrides = configs.some((c) => c.envOverrides?.length > 0);

  return (
    <div className="admin-page">
      <PageHeader
        icon={Server}
        title="Nodes"
        subtitle={(() => {
          // The config carries no top-level `enabled`; whether checkout offers
          // a coin is its `payments_enabled` field — the same toggle the card
          // renders. Reading `c.enabled` made every store say "No coins
          // enabled" however many were switched on.
          const enabled = configs.filter(c => {
            const f = c.fields?.payments_enabled;
            return String(f?.env ? f.effective : f?.value) === 'true';
          });
          if (enabled.length === 0) return 'No coins enabled — checkout cannot take crypto.';
          // Reachability is what actually gates checkout, so it leads. The
          // status rows call this `connected` — the same field the per-coin
          // card reads to decide between "connected" and "unreachable".
          const up = enabled.filter(c => statusFor(c.coin)?.connected).length;
          return up === enabled.length
            ? `${up} of ${enabled.length} enabled coin${enabled.length === 1 ? '' : 's'} reachable`
            : `${enabled.length - up} of ${enabled.length} enabled coin${enabled.length === 1 ? '' : 's'} unreachable`;
        })()}
      >
        <AskAbout
          question="What do the node settings control — the RPC connection, the wallet, how its traffic is routed, and whether a coin is offered at checkout — and what breaks if a node is unreachable?"
          title="Ask the assistant about node configuration"
        />
        <button className="glass-btn glass-btn-sm" onClick={refreshAll} disabled={refreshing}>
          <RefreshCw size={12} /> {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </PageHeader>

      {refreshing && <ProgressBar className="nodes-progress" label="Refreshing node connections…" detail="Waiting for the configured nodes and Tor proxy to respond." />}

      <p className="admin-hint" style={{ marginTop: 'calc(var(--sp-3) * -1)' }}>
        Point the store at a Bitcoin, Litecoin or Monero node and choose which coins customers can pay
        with. Payment addresses are generated by the node itself, so a coin can only be accepted at
        checkout while its node is enabled and reachable.
      </p>

      <TorProxyBanner status={torStatus} onRetry={fetchTorStatus} />

      {!can.configureNodes && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
          <AlertTriangle size={12} /> You can watch these nodes but not change them — that needs the “Configure nodes” permission.
        </p>
      )}

      {anyEnvOverrides && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
          <Terminal size={12} /> Some fields are pinned by environment variables. Those inputs are disabled here — change them in <code>.env</code> and restart.
        </p>
      )}

      {can.unlockWallets && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
          Unlocking opens an encrypted Bitcoin or Litecoin wallet for the longest window the daemon
          accepts, so it stays open until you lock it here — but it does re-lock on every daemon
          restart, so check this page after maintenance. While unlocked the wallet can spend, so lock
          it again when you are done.
        </p>
      )}

      {/* Only when the banner above is not already naming the proxy — which it
          skips when nothing is routed through Tor. */}
      {torProxy && (!torStatus || (torStatus.ok && (torStatus.dependents?.length ?? 0) === 0)) && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', marginTop: 'var(--sp-15)' }}>
          <Link2 size={11} /> Tor traffic goes through <code>{torProxy.host}:{torProxy.port}</code>
          {torProxy.source === 'env'
            ? ' (pinned by the environment)'
            : torProxy.source === 'settings'
              ? ' (from Settings → Tor proxy)'
              : ' (default)'}
        </p>
      )}

      <div style={{ display: 'grid', gap: 'var(--sp-4)', gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))', marginTop: 'var(--sp-4)' }}>
        {configs.map((config) => (
          <NodeCard
            key={config.coin}
            config={config}
            status={statusFor(config.coin)}
            can={can}
            onSaved={onSaved}
            onRefresh={() => fetchStatus(true)}
          />
        ))}
      </div>
      <NextStops route="/admin/nodes" />
    </div>
  );
}
