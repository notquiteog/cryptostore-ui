import { useId } from 'react';

/** A measured value when available; an active track when the server cannot
 * measure the remaining work. Unknown duration must never become a fake 99%. */
export default function ProgressBar({ label = 'Loading…', detail, value, className = '' }) {
  const id = useId();
  const measured = typeof value === 'number' && Number.isFinite(value);
  const percent = measured ? Math.max(0, Math.min(100, value)) : null;
  return (
    <div className={`work-progress ${className}`}>
      <div className="work-progress-heading">
        <span id={id} role="status">{label}</span>
        {measured && <span className="work-progress-value" aria-hidden="true">{Math.floor(percent)}%</span>}
      </div>
      <div className={`work-progress-track${measured ? '' : ' is-indeterminate'}`}
        role="progressbar" aria-labelledby={id} aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={measured ? Math.floor(percent) : undefined}
        aria-describedby={detail ? `${id}-detail` : undefined}>
        <span className="work-progress-fill" style={measured ? { transform: `scaleX(${percent / 100})` } : undefined} />
      </div>
      {detail && <span id={`${id}-detail`} className="work-progress-detail">{detail}</span>}
    </div>
  );
}

export function LoadingProgress({ label = 'Loading…', detail, value }) {
  return <div className="loading-page"><ProgressBar label={label} detail={detail} value={value} /></div>;
}
