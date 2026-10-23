import { Users, Package, Wallet, Clock, AlertTriangle, Infinity as InfinityIcon } from 'lucide-react';

/**
 * Shared limit editor and usage display for the rotating payment-recipient
 * pools (cash-in-mail addresses and Zelle accounts). Both pools behave
 * identically, so both screens render from here.
 */

const money = (v) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const LIMIT_FIELDS = [
  { key: 'daily_limit', label: 'Daily limit', hint: 'Rolling 24 hours' },
  { key: 'monthly_limit', label: 'Monthly limit', hint: 'Rolling 30 days' },
  { key: 'lifetime_limit', label: 'Lifetime limit', hint: 'All time' },
];

/**
 * Three optional caps. Blank means uncapped — the recipient stays in rotation
 * indefinitely for that window.
 */
export function LimitFields({ data, setData }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, marginBottom: 'var(--sp-15)' }}>Receive limits</div>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginTop: 0, marginBottom: 'var(--sp-25)' }}>
        Optional. Once a recipient cannot cover an order within a limit, the next buyer is handed a
        different one. Leave blank for no cap. Windows are rolling, not calendar — the store cannot
        know the receiving bank's timezone, and a rolling window never allows more than the cap in any
        24-hour stretch.
      </p>
      <div className="form-row">
        {LIMIT_FIELDS.map((field) => (
          <div className="form-group" key={field.key}>
            <label>{field.label}</label>
            <input
              className="glass-input"
              type="number"
              min="0"
              step="0.01"
              value={data[field.key] ?? ''}
              onChange={(e) => setData({ ...data, [field.key]: e.target.value })}
              placeholder="No limit"
            />
            <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-2xs)' }}>{field.hint}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function Meter({ label, used, limit }) {
  if (limit === null || limit === undefined) return null;
  const pctUsed = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  const remaining = Math.max(0, limit - used);
  const tight = pctUsed >= 90;

  return (
    <div style={{ marginTop: 'var(--sp-2)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
        <span>{label}</span>
        <span style={{ color: tight ? 'var(--warning)' : 'var(--text-secondary)' }}>
          {money(remaining)} left of {money(limit)}
        </span>
      </div>
      <div style={{ height: 5, background: 'rgba(var(--tint-rgb), 0.08)', borderRadius: 3, overflow: 'hidden', marginTop: 'var(--sp-1)' }}>
        <div style={{
          width: `${pctUsed}%`,
          height: '100%',
          background: pctUsed >= 100 ? 'var(--danger)' : tight ? 'var(--warning)' : 'var(--success)',
          transition: 'width 0.3s ease',
        }} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, title }) {
  return (
    <div title={title} style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)', fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
      <Icon size={12} style={{ flexShrink: 0 }} />
      <span style={{ color: 'var(--text)', fontWeight: 600 }}>{value}</span> {label}
    </div>
  );
}

/**
 * Usage for one recipient. `stats` is null when the viewer lacks
 * `orders.recipient_stats`, and `distinct_customers` is null when they lack
 * `orders.view_customer` — both render as an explicit note rather than a zero,
 * so a hidden figure is never mistaken for "nothing happened here".
 */
export function RecipientStats({ stats, capacity }) {
  if (!stats) {
    return (
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '0.5rem 0 0' }}>
        Usage statistics need the “View recipient usage” permission.
      </p>
    );
  }

  const exhausted = capacity?.exhausted;

  return (
    <div style={{ marginTop: 'var(--sp-25)', paddingTop: 'var(--sp-25)', borderTop: '1px solid rgba(var(--tint-rgb), 0.07)' }}>
      <div style={{ display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <Stat icon={Package} label="orders" value={stats.orders_assigned}
          title="Orders this recipient has been assigned to" />
        <Stat
          icon={Users}
          label="customers"
          value={stats.distinct_customers === null ? '—' : stats.distinct_customers}
          title={stats.distinct_customers === null
            ? 'Requires the “See customer identity” permission'
            : 'Distinct accounts that have been shown this recipient'}
        />
        <Stat icon={Wallet} label="received" value={`$${money(stats.confirmed_total)}`}
          title="Confirmed receipts. Refunded orders are excluded." />
        {stats.held_total > 0 && (
          <Stat icon={Clock} label="pending" value={`$${money(stats.held_total)}`}
            title="Reserved by orders that have not been confirmed yet. Released automatically if they are never paid." />
        )}
        {stats.reversed_total > 0 && (
          <Stat icon={AlertTriangle} label="refunded" value={`$${money(stats.reversed_total)}`}
            title="Refunded — no longer counts against the limits" />
        )}
      </div>

      {capacity && capacity.effective_remaining === null ? (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '0.45rem 0 0', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <InfinityIcon size={11} /> No receive limit set
        </p>
      ) : (
        <>
          <Meter label="Daily" used={stats.used_24h} limit={capacity?.daily_limit} />
          <Meter label="Monthly" used={stats.used_30d} limit={capacity?.monthly_limit} />
          <Meter label="Lifetime" used={stats.used_lifetime} limit={capacity?.lifetime_limit} />
        </>
      )}

      {exhausted && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--warning)', margin: '0.45rem 0 0', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <AlertTriangle size={11} /> At its limit — buyers are being routed to other recipients.
        </p>
      )}
    </div>
  );
}

export { money };
