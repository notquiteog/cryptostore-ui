import ProgressBar from '../../components/ProgressBar';
import { useState, useEffect, useMemo, useRef, useId, useReducer } from 'react';
import { api } from '../../utils/api';
import EffectsCard from '../../components/admin/EffectsCard';
import AskAbout from '../../components/admin/AskAbout';
import PresetGallery from '../../components/admin/PresetGallery';
import { BACKGROUND_SHADERS, HEADER_SHADERS } from '../../components/effects/shaders';
import { useTheme } from '../../context/ThemeContext';
import { resolveMode, contrastReport } from '../../theme/computeVars';
import {
  DEFAULT_THEME, PALETTE_ROLES, SCALAR_FIELDS, SCALAR_BY_KEY, EDITABLE_KEYS, lightKey,
  FONT_ROSTER, FONT_KEYS, fontGroupFor, COLOR_KEYS,
} from '../../theme/defaults';
import {
  BUILTIN_PRESETS, presetPatch, captureAsPreset, parseCustomPresets, resolvePresets,
  presetMaterialLabel, presetEffectsOn,
} from '../../theme/presets';
import { adjustForContrast, isStorableHex, parseHex, toHex } from '../../theme/color';
import toast from 'react-hot-toast';
import {
  Save, RotateCcw, Sparkles, Wind, Eye, EyeOff, Palette, Droplets, Smartphone,
  Moon, Sun, Monitor, Contrast, LayoutPanelTop, Type, Paintbrush, Image as ImageIcon,
  Sunrise, Squircle, Wand2, Check, AlertTriangle, SwatchBook, Trash2, Plus, Pencil,
  Snowflake, Waves, Undo2, Redo2, Radar,
} from 'lucide-react';
import ThemeTabs from '../../components/admin/ThemeTabs';
import ThemePreview from '../../components/admin/ThemePreview';
import { createThemeDraft, themeDraftReducer, themeChanges, mergeThemeDraft } from '../../theme/draft';
import { THEME_TABS, tabForKey } from '../../theme/themeTabs';
import NextStops from '../../components/admin/NextStops';

const MODES = [
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Always the dark palette.' },
  { value: 'light', label: 'Light', icon: Sun, hint: 'Always the light palette.' },
  { value: 'auto', label: 'Auto', icon: Monitor, hint: "Follows each visitor's operating system setting." },
];

const LOGO_SIZES = [
  { value: 'standard', label: 'Standard', hint: 'Square or badge-shaped mark, up to 120px wide.' },
  { value: 'wide', label: 'Wide', hint: 'Horizontal wordmark, up to 260px wide.' },
];

const GROUP_LABEL = {
  brand: 'Brand',
  ground: 'Page',
  status: 'Status',
  glow: 'Glow & atmosphere',
};

const rolesIn = (group) => PALETTE_ROLES.filter((r) => r.group === group);

/**
 * Only the keys this editor owns. `colors` is seeded from the whole
 * DEFAULT_THEME — which includes non-editable keys like `store_name` — and
 * pushing that whole object into the live theme context overwrote the real
 * fetched values: the tab retitled itself "CryptoStore" on the first slider
 * drag. The context merges partials, so sending only the editor's keys leaves
 * everything else exactly as the settings fetch delivered it.
 */
const pickEditable = (obj) => {
  const out = {};
  EDITABLE_KEYS.forEach((k) => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
};

const scalarsIn = (group) => SCALAR_FIELDS.filter((f) => f.group === group);

function ColorField({ label, hint, value, onChange, badge }) {
  const id = useId();
  // The SERVER's rule, not the renderer's. `isValidHex` accepts an 8-digit hex
  // by silently dropping the alpha, so `#7e8dffcc` — what most design tools
  // put on the clipboard — drew a correct swatch, showed no error, and then
  // failed the save. And not just its own: the settings controller rejects the
  // whole request on any invalid key, so one pasted alpha discarded every
  // other change on the page.
  const valid = isStorableHex(value);
  const swatch = valid ? toHex(parseHex(value)) : '#000000';
  return (
    <div className="form-group">
      <label htmlFor={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 'var(--sp-1)' }}>
        <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
          {label}
          {badge}
        </span>
        {hint && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 'var(--fs-xs)' }}>{hint}</span>
        )}
      </label>
      <div style={{ display: 'flex', gap: 'var(--sp-25)', alignItems: 'center' }}>
        <input
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          style={{ width: 44, height: 38, flexShrink: 0 }}
          aria-label={label}
        />
        <input
          id={id}
          aria-invalid={!!value && !valid}
          aria-describedby={value && !valid ? `${id}-error` : undefined}
          className="glass-input"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-base)',
            borderColor: value && !valid ? 'var(--danger)' : undefined,
          }}
          placeholder="#hex"
          spellCheck="false"
        />
      </div>
      {value && !valid && (
        <small id={`${id}-error`} style={{ color: 'var(--danger)', fontSize: 'var(--fs-xs)' }}>
          Use 3 or 6 hex digits, such as #abc or #aabbcc.
        </small>
      )}
    </div>
  );
}

function SliderField({ label, hint, value, min, max, step, unit, onChange }) {
  const id = useId();
  return (
    <div className="form-group">
      <label htmlFor={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600 }}>{label}</span>
        <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 600, fontFamily: 'var(--font-display)', fontFeatureSettings: '"tnum"' }}>
          {value}{unit}
        </span>
      </label>
      {hint && <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginTop: 'calc(var(--sp-1) * -1)', marginBottom: 'var(--sp-2)', lineHeight: 1.5 }}>{hint}</div>}
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * One card on the theme page.
 *
 * `data-theme-section` is what the rail navigates by — deliberately NOT
 * `data-settings-section`, which the admin nav's search resolves against on
 * /admin/settings. Two pages marking their cards with one attribute would put
 * this page's twenty answers in front of a resolver expecting the other's.
 *
 * The head gained a rule under it and the title dropped from an all-caps
 * micro-label to an actual heading: thirteen cards at one weight, each opening
 * with 0.78rem uppercase tracking, read as thirteen identical boxes rather
 * than as a document with parts.
 */
function SectionCard({ id, icon: Icon, title, action, children, style }) {
  return (
    <section
      className="glass-card aset-card"
      data-theme-section={id}
      style={style}
      aria-labelledby={id ? `thm-h-${id}` : undefined}
    >
      <div className="aset-card-head">
        <h2 className="aset-card-title" id={id ? `thm-h-${id}` : undefined}>
          {Icon && <Icon size={17} aria-hidden="true" />}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function ToggleField({ label, icon: Icon, hint, enabled, onToggle, children }) {
  return (
    <div style={{
      border: '1px solid var(--glass-border)',
      borderRadius: 'var(--radius)',
      padding: 'var(--sp-4) var(--sp-4)',
      marginBottom: enabled ? '1rem' : '0.65rem',
      background: enabled ? 'var(--btn-bg)' : 'transparent',
      transition: 'background var(--transition), border-color var(--transition)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--sp-4)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-25)', minWidth: 0 }}>
          {Icon && <Icon size={16} style={{ color: enabled ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>{label}</div>
            {hint && <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginTop: 'var(--sp-05)' }}>{hint}</div>}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label={label}
          aria-pressed={enabled}
          className={`glass-btn glass-btn-sm${enabled ? ' glass-btn-active' : ''}`}
          style={{ minWidth: 72, justifyContent: 'center' }}
        >
          {enabled ? <><Eye size={13} /> On</> : <><EyeOff size={13} /> Off</>}
        </button>
      </div>
      {enabled && children && <div style={{ marginTop: 'var(--sp-4)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--border)' }}>{children}</div>}
    </div>
  );
}

/** The five swatches that identify a palette at a glance. */
const PRESET_DOT_KEYS = ['theme_bg', 'theme_primary', 'theme_secondary', 'theme_accent', 'theme_warning'];

/**
 * The ambient-effect roster the editor renders from, split by WHERE the effect
 * paints.
 *
 * They were one list, and the list was wrong about the thing that matters
 * most: five of these cover the entire viewport behind every page and one is a
 * strip 60px tall. Those are different decisions with different costs — a
 * background field is a full-screen composite on every frame, the header is
 * not — and reading them as six peers is how an operator ends up running two
 * full-screen canvases because the rows looked interchangeable.
 *
 * `engine` labels each row as canvas or WebGL2, because the two answer
 * different questions on an old machine. A 2D canvas effect degrades to a slow
 * frame rate; a WebGL2 one does not run at all where there is no WebGL2, and
 * an operator has to know which of those they are choosing before a visitor
 * writes in to say the background is missing.
 */
const EFFECT_ROSTER = [
  {
    scope: 'background', engine: 'canvas',
    toggleKey: 'effects_sparkles', colorKey: 'theme_sparkle_color',
    label: 'Sparkles', colorLabel: 'Sparkle', icon: Sparkles,
    hint: 'Drifting stars that twinkle across every page',
    colorHint: 'Color of drifting stars',
  },
  {
    scope: 'background', engine: 'canvas',
    toggleKey: 'effects_smoke', colorKey: 'theme_smoke_color',
    label: 'Smoke', colorLabel: 'Smoke', icon: Wind,
    hint: 'Full-screen drifting smoke clouds for deep atmosphere',
    colorHint: 'Color of ambient smoke clouds',
  },
  {
    scope: 'background', engine: 'canvas',
    toggleKey: 'effects_snow', colorKey: 'theme_snow_color',
    label: 'Snowfall', colorLabel: 'Snow', icon: Snowflake,
    hint: 'Slow flakes with individual sway — no two swing together',
    colorHint: 'Color of the flakes',
  },
  {
    scope: 'background', engine: 'canvas',
    toggleKey: 'effects_aurora', colorKey: 'theme_aurora_color',
    label: 'Aurora', colorLabel: 'Aurora', icon: Waves,
    hint: 'Hundreds of soft light columns drifting through a noise field, each fading in and out over its own lifetime',
    colorHint: 'Color of the light',
  },
  {
    scope: 'header', engine: 'canvas',
    toggleKey: 'effects_header', colorKey: 'theme_header_color',
    label: 'Constellation', colorLabel: 'Field', icon: Radar,
    hint: 'A constellation behind the nav bar that is invisible until a pointer is over it, and stops when it leaves. Desktop only — it never starts on a touch device.',
    colorHint: 'Color of the points and links',
  },
];

/** Rows for one scope, in roster order. */
const effectsFor = (scope) => EFFECT_ROSTER.filter((fx) => fx.scope === scope);

function PresetCard({ preset, onApply, onEdit, onDelete, onReset }) {
  const s = preset.settings;
  const fontLine = ['ui', 'display', 'mono']
    .map((group, i) => FONT_ROSTER[group][s[['theme_font_ui', 'theme_font_display', 'theme_font_mono'][i]]]?.label)
    .filter(Boolean).join(' · ');
  // Only the effects a preset STARTS get a chip. Carried-but-off effects are
  // the unsurprising case; a full-screen canvas switching on is the one thing
  // an operator must see before clicking Both.
  const effectsOn = presetEffectsOn(preset);
  // Named rather than assumed: three built-ins deliberately have no frost at
  // all, and calling their surfaces glass on the card is the one thing this
  // chip exists to prevent.
  const materialLabel = presetMaterialLabel(preset);
  return (
    <div className="preset-card">
      <div className="preset-card-head">
        <span className="preset-card-name">
          {preset.label}
          {preset.overridden && <span className="preset-edited-badge">edited</span>}
        </span>
        <span className="preset-card-tools">
          <button
            type="button"
            className="glass-btn glass-btn-sm preset-tool"
            onClick={onEdit}
            title={`Edit "${preset.label}" — loads it into the editor; Update preset saves it back`}
            aria-label={`Edit preset "${preset.label}"`}
          >
            <Pencil size={12} />
          </button>
          {preset.overridden && (
            <button
              type="button"
              className="glass-btn glass-btn-sm preset-tool"
              onClick={onReset}
              title={`Discard your edits to "${preset.label}" and restore the built-in`}
              aria-label={`Restore built-in "${preset.label}"`}
            >
              <RotateCcw size={12} />
            </button>
          )}
          <button
            type="button"
            className="glass-btn glass-btn-sm preset-tool preset-delete"
            onClick={onDelete}
            title={preset.builtin
              ? `Hide built-in "${preset.label}" (restorable below)`
              : `Delete preset "${preset.label}"`}
            aria-label={`Delete preset "${preset.label}"`}
          >
            <Trash2 size={12} />
          </button>
        </span>
      </div>
      {preset.description && <p className="preset-card-desc">{preset.description}</p>}
      <div className="preset-dots" aria-hidden="true">
        <Moon size={11} className="preset-dots-mode" />
        {PRESET_DOT_KEYS.map((k) => (
          <span key={k} className="preset-dot" style={{ background: s[k] || 'transparent' }} />
        ))}
      </div>
      <div className="preset-dots" aria-hidden="true">
        <Sun size={11} className="preset-dots-mode" />
        {PRESET_DOT_KEYS.map((k) => (
          <span key={k} className="preset-dot" style={{ background: s[`${k}_light`] || s[k] || 'transparent' }} />
        ))}
      </div>
      {(fontLine || materialLabel || effectsOn.length > 0) && (
        <div className="preset-fonts">
          {materialLabel && (
            <span
              className="preset-material-chip"
              title={`Applying with Both also sets the surface itself: opacity, blur, vividness, edge light, roundness, glow. This one is ${materialLabel}.`}
            >
              {materialLabel}
            </span>
          )}
          {effectsOn.map((fx) => (
            <span
              key={fx}
              className="preset-effect-chip"
              title={`Applying with Both starts the ambient ${fx} effect, in this preset's own colour. It pauses on hidden tabs and stills under reduced motion.`}
            >
              {fx} on
            </span>
          ))}
          {fontLine}
        </div>
      )}
      <div className="preset-apply" role="group" aria-label={`Apply ${preset.label}`}>
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => onApply('dark')}>
          <Moon size={12} /> Dark
        </button>
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => onApply('light')}>
          <Sun size={12} /> Light
        </button>
        <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={() => onApply('both')}>
          Both
        </button>
      </div>
    </div>
  );
}

/**
 * Every foreground/background pair an admin can break, graded against WCAG.
 *
 * This replaces a single warning that fired when the background and text were
 * within 90 points of each other on the BT.601 brightness scale — a measure
 * that is not contrast and cannot be compared to any standard. It passed the
 * shipped default of brand-cyan-on-white at 1.69:1 without a word.
 */
function ContrastScorecard({ settings, mode, onFix }) {
  const rows = useMemo(() => contrastReport(settings, mode, { components: true }), [settings, mode]);
  const failing = rows.filter((r) => r.level === 'fail' || r.level === 'large');

  return (
    <div>
      <div style={{ display: 'grid', gap: 'var(--sp-1)' }}>
        {rows.map((r) => {
          const bad = r.level === 'fail';
          const meh = r.level === 'large';
          const tone = bad ? 'var(--danger)' : meh ? 'var(--warning)' : 'var(--success)';
          return (
            <div
              key={r.label}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--sp-3)',
                padding: 'var(--sp-2) var(--sp-3)', borderRadius: 'var(--radius-sm)',
                background: 'rgba(var(--tint-rgb),0.03)',
                border: '1px solid var(--border)',
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                background: r.fg, border: '1px solid var(--border)',
              }} />
              <span style={{ flex: 1, fontSize: 'var(--fs-base)', minWidth: 0 }}>{r.label}</span>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)',
                fontVariantNumeric: 'tabular-nums', color: 'var(--text-secondary)',
              }}>
                {r.ratio.toFixed(2)}:1
              </span>
              <span
                className={`badge ${bad ? 'badge-danger' : meh ? 'badge-warning' : 'badge-success'}`}
                style={{ fontSize: 'var(--fs-3xs)', minWidth: 52, justifyContent: 'center' }}
              >
                {bad ? 'fails' : meh ? 'large only' : r.level}
              </span>
              {(bad || meh) && r.scope === 'palette' && (
                <button
                  type="button"
                  className="glass-btn glass-btn-sm"
                  onClick={() => onFix(r)}
                  title={`Darken or lighten this colour until it reaches 4.5:1 on ${r.bg}`}
                  style={{ color: tone }}
                >
                  <Wand2 size={12} /> Fix
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', margin: '0.8rem 0 0', lineHeight: 1.6 }}>
        {failing.length === 0 ? (
          <><Check size={12} style={{ verticalAlign: '-2px', color: 'var(--success)' }} /> All checked palette and component pairs meet their contrast target.</>
        ) : (
          <><AlertTriangle size={12} style={{ verticalAlign: '-2px', color: 'var(--warning)' }} /> {failing.length} pair{failing.length === 1 ? '' : 's'} below its contrast target in <strong style={{ color: 'var(--text)' }}>{mode}</strong> mode. Fix nudges it toward the ground until it passes, keeping the hue.</>
        )}
      </p>
    </div>
  );
}

export default function AdminTheme() {
  const { updateTheme, settings: liveSettings, loaded: themeLoaded } = useTheme();
  const [draft, dispatchDraft] = useReducer(themeDraftReducer, DEFAULT_THEME, createThemeDraft);
  const colors = draft.present;
  const setColors = (value) => dispatchDraft({ type: 'edit', value, time: Date.now() });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const revision = useRef(null);
  const [versions, setVersions] = useState([]);
  const [conflict, setConflict] = useState(null);
  const [conflictChoices, setConflictChoices] = useState({});
  const savingRef = useRef(false);
  const mounted = useRef(false);
  // Which mode's colours the editor is showing. Independent of the saved mode
  // so a `dark` store can still tune its light palette before switching.
  const [editing, setEditing] = useState('dark');
  const latest = useRef({ colors, editing });
  latest.current = { colors, editing };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Previewing writes the previewed mode into the shared theme context. Without
  // this, walking away from the page mid-preview would leave the whole admin in
  // a mode nobody chose, until a reload.
  //
  // The ref matters: `updateTheme`'s identity is stable now, but `colors` is
  // not — depending on it would tear this effect down on every keystroke and
  // restore the saved mode a beat after each edit. An empty dep list runs the
  // restore once, on unmount, with the newest colours.
  /**
   * The last PERSISTED palette — what the store looks like to everybody who is
   * not sitting on this page. Set when settings load and again after every
   * successful save, and it is what unmount restores.
   *
   * This used to restore `colors`, the edited working copy, which meant
   * leaving the page COMMITTED whatever was on the sliders. `updateTheme`
   * repaints <html> and caches the palette in localStorage, which index.html's
   * pre-paint bootstrap replays — so dragging Glow strength to 2.5x and then
   * clicking Orders left the whole admin at 2.5x for the rest of the session
   * and flashed that way again on the next cold load. The page's own copy
   * says "Changes preview live. Click Save to persist", and a preview that
   * persists itself on navigate is the opposite of that promise.
   */
  /*
   * Which section is on screen. Presets rather than the first tab: it is both
   * the most-used control on the page and the one that changes the most at
   * once, so it is what the page should open on.
   */
  const [tab, setTab] = useState('presets');
  const savedColors = useRef(null);

  const restoreSavedTheme = useRef(null);
  // Skipped while the page is still loading: StrictMode's simulated unmount
  // would otherwise re-apply the defaults before the saved theme has arrived.
  restoreSavedTheme.current = () => {
    if (!loading && savedColors.current) updateTheme(pickEditable(savedColors.current));
  };
  useEffect(() => () => restoreSavedTheme.current?.(), []);

  useEffect(() => {
    // Let the provider finish its initial fetch before opening the workbench;
    // a late public-settings response must not overwrite the first live edit.
    if (!themeLoaded) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    api.get('/settings/theme')
      .then((publication) => {
        const data = publication.settings;
        revision.current = publication.revision;
        setVersions(publication.versions || []);
        if (cancelled) return;
        const picked = {};
        EDITABLE_KEYS.forEach((k) => {
          if (data[k] !== undefined && data[k] !== null && data[k] !== '') picked[k] = data[k];
        });
        const loaded = { ...DEFAULT_THEME, ...picked };
        savedColors.current = loaded;
        dispatchDraft({ type: 'load', value: loaded });
        setEditing(resolveMode(picked.theme_mode || DEFAULT_THEME.theme_mode));
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load the saved theme.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [loadAttempt, themeLoaded]);

  /** Is the working copy different from what is actually stored? */
  /*
   * Which keys differ from the stored theme.
   *
   * A count rather than the boolean this used to be, because the save bar says
   * how many: "3 unsaved changes" is a different message from "unsaved
   * changes" on a page where an operator may have nudged one slider or applied
   * a whole preset, and the number is the only thing that tells those apart.
   */
  const changedKeys = (!loading && savedColors.current)
    ? EDITABLE_KEYS.filter((k) => String(colors[k] ?? '') !== String(savedColors.current[k] ?? ''))
    : [];
  const invalidColors = EDITABLE_KEYS.filter((k) =>
    (COLOR_KEYS.includes(k) || /^(?:theme|pwa)_.*color(?:_2)?$/.test(k) || k === 'pwa_background_color')
    && colors[k] && !isStorableHex(colors[k]));
  const undoRedo = (type) => {
    const next = themeDraftReducer(draft, { type });
    dispatchDraft({ type });
    updateTheme(pickEditable(next.present), { previewMode: editing });
  };

  /*
   * How many unsaved changes sit on each tab, for the dots.
   *
   * Recomputed from `changedKeys` rather than tracked as the operator types:
   * a tally maintained by hand drifts the first time a change is applied by
   * something other than a field — and on this page that is the common case,
   * since applying a preset writes forty keys at once.
   */
  const changedByTab = {};
  for (const k of changedKeys) {
    const t = tabForKey(k);
    changedByTab[t] = (changedByTab[t] || 0) + 1;
  }

  /**
   * Throw the working copy away and go back to the stored look.
   *
   * The page had no route back at all: no Cancel, no dirty indicator, and an
   * unmount that committed rather than reverted. Once "leave the page" stopped
   * being an accidental save, it also stopped being the only way to abandon an
   * experiment — so there had to be a deliberate one.
   */
  const discardChanges = () => {
    if (!savedColors.current) return;
    const saved = savedColors.current;
    setColors(saved);
    const mode = resolveMode(saved.theme_mode || DEFAULT_THEME.theme_mode);
    setEditing(mode);
    updateTheme(pickEditable(saved), { previewMode: mode });
    toast.success('Reverted to the saved theme');
  };

  /** The stored key for a palette role in whichever mode is being edited. */
  const keyFor = (baseKey) => (editing === 'light' ? lightKey(baseKey) : baseKey);

  /** What that key currently resolves to, following the dark-twin fallback. */
  const valueFor = (baseKey) => {
    const k = keyFor(baseKey);
    if (colors[k] !== undefined && colors[k] !== '') return colors[k];
    if (editing === 'light') return colors[baseKey] ?? DEFAULT_THEME[k] ?? DEFAULT_THEME[baseKey];
    return DEFAULT_THEME[baseKey];
  };

  // Both calls happen from event handlers, so `colors` is the current render's
  // value and merging outside the updater is safe. Calling `updateTheme` from
  // *inside* a `setColors` updater would set state on ThemeProvider while this
  // component is rendering, which React warns about and StrictMode doubles.
  const applyChange = (patch) => {
    const next = { ...colors, ...patch };
    setColors(next);
    updateTheme(pickEditable(next), { previewMode: editing });
  };

  const handleChange = (key, value) => applyChange({ [key]: value });

  const setMode = (mode) => {
    const next = resolveMode(mode);
    setEditing(next);
    const merged = { ...colors, theme_mode: mode };
    setColors(merged);
    updateTheme(pickEditable(merged), { previewMode: next });
  };

  /**
   * Show a mode without changing what the store is set to.
   * Editing the light palette while the store runs dark is otherwise blind
   * guesswork — you cannot see the colours you are choosing.
   */
  const previewMode = (mode) => {
    setEditing(mode);
    updateTheme(pickEditable(colors), { previewMode: mode });
  };

  const handleSave = async () => {
    if (savingRef.current || invalidColors.length || loadError || !savedColors.current) return;
    savingRef.current = true;
    const snapshot = { ...colors };
    dispatchDraft({ type: 'checkpoint' });
    setSaving(true);
    try {
      const payload = themeChanges(savedColors.current, snapshot, EDITABLE_KEYS);
      const publication = await api.put('/settings/theme', { changes: payload, base_revision: revision.current });
      const persisted = { ...DEFAULT_THEME, ...publication.settings };
      const newer = themeChanges(snapshot, latest.current.colors, EDITABLE_KEYS);
      savedColors.current = persisted;
      revision.current = publication.revision;
      setVersions(publication.versions || []);
      setConflict(null);
      updateTheme(pickEditable(persisted));
      if (mounted.current) {
        const next = { ...persisted, ...newer };
        setColors(next);
        updateTheme(pickEditable(next), { previewMode: latest.current.editing });
      }
      toast.success('Theme saved');
    } catch (err) {
      // The API rejects the whole request when any value is malformed, and
      // names the offenders — surface that rather than a generic failure.
      if (err.data?.revision && err.data?.settings) {
        setConflict({ published: { ...DEFAULT_THEME, ...err.data.settings }, revision: err.data.revision });
        setConflictChoices({});
      }
      const invalid = err?.data?.invalid;
      if (Array.isArray(invalid) && invalid.length) {
        toast.error(`${invalid[0].key}: ${invalid[0].error}`);
      } else {
        toast.error(err.message || 'Failed to save');
      }
    }
    savingRef.current = false;
    if (mounted.current) setSaving(false);
  };

  const handleReset = () => {
    // The preset library survives a reset: "reset the theme" means the live
    // palette, not the operator's saved collection — losing those to a reset
    // click would be the only unrecoverable action on this page.
    const reset = { ...DEFAULT_THEME, theme_presets: colors.theme_presets ?? '' };
    setColors(reset);
    setEditing(resolveMode(DEFAULT_THEME.theme_mode));
    updateTheme(pickEditable(reset), { previewMode: resolveMode(DEFAULT_THEME.theme_mode) });
  };

  /** Copy the palette being edited onto the other mode, as a starting point. */
  const copyToOtherMode = () => {
    const patch = {};
    PALETTE_ROLES.forEach((r) => {
      const from = valueFor(r.key);
      patch[editing === 'light' ? r.key : lightKey(r.key)] = from;
    });
    applyChange(patch);
    toast.success(`Copied to ${editing === 'light' ? 'dark' : 'light'} mode — remember to check contrast there`);
  };

  const fixContrast = (row) => {
    const target = PALETTE_ROLES.find((r) => {
      const map = {
        'Body text': 'theme_text', 'Primary / links': 'theme_primary',
        Secondary: 'theme_secondary', Accent: 'theme_accent',
        Success: 'theme_success', Warning: 'theme_warning', Danger: 'theme_danger',
        Logo: 'theme_logo_color',
      };
      return r.key === map[row.label];
    });
    if (!target) return;
    handleChange(keyFor(target.key), adjustForContrast(row.fg, row.bg, 4.5));
  };

  const savedMode = colors.theme_mode || DEFAULT_THEME.theme_mode;
  const previewing = editing !== resolveMode(savedMode);

  // ── PWA app icon ──
  // The upload endpoint owns the setting row (like the store logo's); pushing
  // the returned path into the live theme context is what re-derives the
  // manifest and favicon without a reload.
  const [pwaIconBusy, setPwaIconBusy] = useState(false);
  const uploadPwaIcon = async (file) => {
    if (!file) return;
    setPwaIconBusy(true);
    try {
      const fd = new FormData();
      fd.append('icon', file);
      const result = await api.upload('/settings/upload-pwa-icon', fd);
      updateTheme({ pwa_icon: result.path }, { previewMode: editing });
      toast.success('App icon updated — squared, WebP, metadata stripped');
    } catch (err) {
      toast.error(err.message || 'Icon upload failed');
    }
    setPwaIconBusy(false);
  };

  // ── Presets ──
  const customPresets = useMemo(() => parseCustomPresets(colors.theme_presets), [colors.theme_presets]);
  const { presets: presetList, hiddenBuiltins } = useMemo(
    () => resolvePresets(customPresets), [customPresets],
  );
  const [presetName, setPresetName] = useState('');
  // Which preset the save row updates. Built-ins live in code, so "editing"
  // one stores an override under its id; removing that override restores it.
  const [editingPreset, setEditingPreset] = useState(null);

  const writePresets = (next) => applyChange({ theme_presets: JSON.stringify(next) });

  const applyPreset = (preset, scope) => {
    applyChange(presetPatch(preset, scope));
    toast.success(`${preset.label} → ${scope === 'both' ? 'both modes' : `${scope} mode`}. Save to keep it.`);
  };

  const editPreset = (preset) => {
    applyChange(presetPatch(preset, 'both'));
    setEditingPreset({ id: preset.id, label: preset.label, builtin: preset.builtin });
    setPresetName(preset.label);
    toast(`Editing "${preset.label}" — tune anything, then Update preset`, { icon: '✏️' });
  };

  const cancelEditPreset = () => {
    setEditingPreset(null);
    setPresetName('');
  };

  const savePreset = () => {
    const name = presetName.trim() || editingPreset?.label;
    if (!name) { toast.error('Name the preset first'); return; }
    if (editingPreset) {
      // The id is stable across a rename: it is the storage key (and, for a
      // built-in, the override target), while the label is presentation.
      const next = {
        ...customPresets,
        [editingPreset.id]: { label: name, settings: captureAsPreset(colors, DEFAULT_THEME) },
      };
      writePresets(next);
      cancelEditPreset();
      toast.success(`Updated "${name}" — click Save to persist it`);
      return;
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!id) { toast.error('The name needs at least one letter or digit'); return; }
    // Overriding a built-in is a deliberate act (its Edit button), never a
    // side effect of picking a colliding name for a new preset.
    if (BUILTIN_PRESETS[id]) { toast.error('That name belongs to a built-in preset — use its edit button instead'); return; }
    writePresets({
      ...customPresets,
      [id]: { label: name, settings: captureAsPreset(colors, DEFAULT_THEME) },
    });
    setPresetName('');
    toast.success(`Captured "${name}" — click Save to persist it`);
  };

  const deletePreset = (preset) => {
    if (editingPreset?.id === preset.id) cancelEditPreset();
    const next = { ...customPresets };
    if (preset.builtin) {
      // A built-in cannot be removed from code; the tombstone hides it and
      // "Restore hidden built-ins" below brings it back.
      next[preset.id] = { deleted: true };
      writePresets(next);
      toast.success(`Hid built-in "${preset.label}" — restorable below. Click Save to persist.`);
    } else {
      delete next[preset.id];
      writePresets(next);
      toast.success(`Deleted "${preset.label}" — click Save to make it permanent`);
    }
  };

  const resetPresetOverride = (preset) => {
    if (editingPreset?.id === preset.id) cancelEditPreset();
    const next = { ...customPresets };
    delete next[preset.id];
    writePresets(next);
    toast.success(`"${BUILTIN_PRESETS[preset.id]?.label || preset.label}" restored to the built-in`);
  };

  const restoreHiddenBuiltins = () => {
    const next = { ...customPresets };
    for (const id of hiddenBuiltins) delete next[id];
    writePresets(next);
    toast.success(`Restored ${hiddenBuiltins.length} built-in preset${hiddenBuiltins.length === 1 ? '' : 's'}`);
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 'var(--sp-12)' }}>
        <ProgressBar label="Loading theme…" />
      </div>
    );
  }

  if (loadError) {
    return <div className="thm-load-error" role="alert">
      <AlertTriangle size={24} aria-hidden="true" />
      <h1>Theme unavailable</h1>
      <p>{loadError}</p>
      <button type="button" className="glass-btn" onClick={() => setLoadAttempt((n) => n + 1)}>
        <RotateCcw size={14} /> Try again
      </button>
    </div>;
  }

  /*
   * Which mode's colours are being edited.
   *
   * Lives in the page header, ABOVE the tab strip, so it is on screen whatever
   * section is open. It used to be a card `action`, which put it on Brand &
   * page, Status and Glow and nowhere else — so changing mode from Glass,
   * Navigation bar or any effects tab meant travelling to the Colour mode tab,
   * flipping the STORE's mode to see the other palette, and travelling back.
   * That is a different setting doing this one's job, and it changes what
   * visitors get as a side effect of wanting to look at something.
   *
   * Deliberately NOT merged with the store's dark/light/auto setting on the
   * Colour mode tab, tempting as it looks. This one previews; that one is what
   * the storefront ships. Editing the light palette must not make the store
   * light, which is exactly what the `previewing` badge below is announcing
   * whenever the two disagree.
   */
  const modeSwitch = (
    <div className="thm-mode-switch">
      {previewing && <span className="badge badge-warning thm-previewing">previewing {editing}</span>}
      <span className="thm-mode-label" aria-hidden="true">Editing</span>
      <div className="segmented" role="group" aria-label="Edit colours for">
        <button type="button" className={`segmented-option${editing === 'dark' ? ' active' : ''}`} aria-pressed={editing === 'dark'} onClick={() => previewMode('dark')}>
          <Moon size={13} /> Dark
        </button>
        <button type="button" className={`segmented-option${editing === 'light' ? ' active' : ''}`} aria-pressed={editing === 'light'} onClick={() => previewMode('light')}>
          <Sun size={13} /> Light
        </button>
      </div>
    </div>
  );

  return (
    /* DESIGN §1 and §5: the 760px centred column is gone. Thirteen cards deep
       with a rail beside them, and the breakpoint is a CONTAINER query because
       the admin shell already takes a sidebar's width off the window — a
       viewport query would fire the wide rules in a box too narrow to hold
       them. See components/admin/SettingsShell.jsx, shared with Settings. */
    <div className="admin-page">
      {/* Not PageHeader.

          Every other admin screen opens with a title and a live subtitle, and
          that component is right for them. Here the title said "Theme" under a
          sidebar item reading Theme, and the subtitle described the page to
          someone already on it — two lines of restatement holding the width
          that the one control used on every tab needed. §7: every control must
          justify its pixels, and a heading that repeats the navigation does
          not.

          The `<h1>` stays for anything reading the document rather than
          looking at it — screen readers announce the page, and the landmark is
          what "skip to content" lands on. It is only the pixels that are gone. */}
      <header className="thm-head">
        <h1 className="sr-only">Theme</h1>
        {modeSwitch}
        <div className="thm-history" role="group" aria-label="Theme edit history">
          <button type="button" className="glass-btn glass-btn-sm" disabled={!draft.past.length} onClick={() => undoRedo('undo')}>
            <Undo2 size={14} /> Undo
          </button>
          <button type="button" className="glass-btn glass-btn-sm" disabled={!draft.future.length} onClick={() => undoRedo('redo')}>
            <Redo2 size={14} /> Redo
          </button>
        </div>
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => setTab('preview')}>
          <Eye size={14} /> Compare modes
        </button>
        {/* The one settings page with no PageHeader to hang this off, so it
            joins the header's control group instead. `help-set-theme` is what
            it lands on. */}
        <AskAbout
          question="On the Theme page in the admin panel, what do the colour tokens, the accessibility modes, presets and profiles control, and what is the difference between editing a theme and publishing it?"
          title="Ask the assistant what the Theme page controls"
        />
        {/* Reset stays in the header and Save/Discard do not, because they are
            different kinds of act. Reset throws away the store's whole look and
            returns to the shipped defaults — rare, deliberate, and nothing an
            operator should meet at the bottom of the screen while nudging a
            slider. Save and Discard belong to the working copy, so they follow
            it down the page in the bar. */}
        <button className="glass-btn thm-head-reset" onClick={handleReset}>
          <RotateCcw size={14} /> Reset to defaults
        </button>
      </header>

      {conflict && <section className="glass-card flow-stack" aria-label="Theme save conflict">
        <h2>The published theme changed</h2>
        <p>Your draft is preserved. Choose which overlapping changes to keep, then review and save the merged draft.</p>
        {mergeThemeDraft(savedColors.current, colors, conflict.published).conflicts.map(key => <label className="flow-field" key={key}>
          <span>{key.replace(/_/g, ' ')}</span>
          <select className="glass-input" value={conflictChoices[key] || 'mine'} onChange={e => setConflictChoices(c => ({ ...c, [key]: e.target.value }))}>
            <option value="mine">My draft: {String(colors[key]).slice(0, 90)}</option>
            <option value="published">Published: {String(conflict.published[key]).slice(0, 90)}</option>
          </select>
        </label>)}
        <button type="button" className="glass-btn" onClick={() => {
          const { merged } = mergeThemeDraft(savedColors.current, colors, conflict.published, conflictChoices);
          savedColors.current = conflict.published; revision.current = conflict.revision;
          setColors(merged); updateTheme(pickEditable(merged), { previewMode: editing }); setConflict(null);
        }}>Review merged draft</button>
      </section>}
      <details className="glass-card thm-publications">
        <summary>Published versions · current {revision.current}</summary>
        <p>Restore a version into your draft, preview it, then save to publish. The latest 30 versions are listed.</p>
        <ul className="flow-list">{versions.map(v => <li key={v.id}><span>Version {v.id} · {new Date(v.created_at).toLocaleString()}</span>
          <button type="button" className="glass-btn glass-btn-sm" disabled={saving} onClick={async () => {
            try { const old = await api.get(`/settings/theme/${v.id}`); const restored = { ...DEFAULT_THEME, ...old.settings };
              setColors(restored); updateTheme(pickEditable(restored), { previewMode: editing }); toast.success('Version restored into your draft. Review before saving.');
            } catch (err) { toast.error(err.message); }
          }}>Preview version</button></li>)}</ul>
      </details>

      <ThemeTabs
        sections={THEME_TABS}
        active={tab}
        onSelect={setTab}
        changedByTab={changedByTab}
        dirtyCount={changedKeys.length}
        saving={saving}
        blocked={invalidColors.length > 0 || !!conflict}
        saveNote={invalidColors.length ? `Correct ${invalidColors.length} invalid colour value${invalidColors.length === 1 ? '' : 's'} before saving.` : 'Changes preview on this device. Save to update the storefront.'}
        onSave={handleSave}
        onDiscard={discardChanges}
      >

      {tab === 'mode' && (
      <SectionCard id="mode" icon={Contrast} title="Colour mode">
        <div className="segmented" role="group" aria-label="Colour mode">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`segmented-option${savedMode === m.value ? ' active' : ''}`}
              onClick={() => setMode(m.value)}
              aria-pressed={savedMode === m.value}
            >
              <m.icon size={14} /> {m.label}
            </button>
          ))}
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: '0.75rem 0 0', lineHeight: 1.6 }}>
          {MODES.find((m) => m.value === savedMode)?.hint}
          {' '}Dark and light now keep <strong style={{ color: 'var(--text)' }}>separate values for every colour</strong>,
          not just the background and text — a hue that reads well on near-black almost never reads well on near-white.
        </p>

        <div style={{ marginTop: 'var(--sp-4)' }}>
          <ToggleField
            label="Let visitors switch mode"
            icon={Monitor}
            hint="Adds a dark / light / auto toggle to the store's navigation. Each visitor's choice stays on their own device; the mode above remains the default."
            enabled={colors.theme_allow_visitor_mode !== 'false'}
            onToggle={() => handleChange('theme_allow_visitor_mode', colors.theme_allow_visitor_mode !== 'false' ? 'false' : 'true')}
          />
        </div>
      </SectionCard>
      )}

      {tab === 'presets' && (
      <SectionCard id="presets" icon={SwatchBook} title="Presets">
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '-0.4rem 0 1.1rem', lineHeight: 1.6 }}>
          Complete looks, appliable to <strong style={{ color: 'var(--text)' }}>one mode or both</strong> —
          run Ledger at night and Porcelain by day, or capture your current setup below and reuse it.
          Dark and Light move colours alone; fonts, the room (tint, grain), ambient effects and — for
          presets wearing a <strong style={{ color: 'var(--text)' }}>material</strong> chip — the
          surface itself travel only with <strong style={{ color: 'var(--text)' }}>Both</strong>. The
          chip says which material: opaque, glass, or heavy glass. Another names each effect a preset
          switches on. Applying previews live; nothing persists until you Save.
        </p>
        {/* Grouped and filterable rather than one long grid: see
            components/admin/PresetGallery.jsx for why fifty cards in a flat
            auto-fill wall is not a choice an operator can actually make. The
            card stays here, passed in, because it is bound to this page's
            apply/edit/delete handlers and nothing else renders one. */}
        <PresetGallery
          presets={presetList}
          renderCard={(p) => (
            <PresetCard
              key={p.id}
              preset={p}
              onApply={(scope) => applyPreset(p, scope)}
              onEdit={() => editPreset(p)}
              onDelete={() => deletePreset(p)}
              onReset={() => resetPresetOverride(p)}
            />
          )}
        />
        {editingPreset && (
          <div className="preset-editing-banner">
            <Pencil size={12} />
            Editing <strong>{editingPreset.label}</strong>
            {editingPreset.builtin && ' (built-in — Update stores your version, its reset button restores the original)'}
            <button type="button" className="glass-btn glass-btn-sm" onClick={cancelEditPreset}>
              Cancel
            </button>
          </div>
        )}
        <div className="preset-save-row">
          <input
            className="glass-input"
            placeholder={editingPreset ? 'Rename the preset…' : 'Name the current colours…'}
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); }}
            maxLength={60}
            style={{ margin: 0, flex: 1, minWidth: 180 }}
            aria-label={editingPreset ? `Rename preset ${editingPreset.label}` : 'New preset name'}
          />
          <button type="button" className={`glass-btn${editingPreset ? ' glass-btn-primary' : ''}`} onClick={savePreset}>
            {editingPreset ? <><Check size={14} /> Update preset</> : <><Plus size={14} /> Save current as preset</>}
          </button>
        </div>
        {hiddenBuiltins.length > 0 && (
          <button type="button" className="glass-btn glass-btn-sm preset-restore-hidden" onClick={restoreHiddenBuiltins}>
            <RotateCcw size={12} /> Restore {hiddenBuiltins.length} hidden built-in
            preset{hiddenBuiltins.length === 1 ? '' : 's'}
            {' '}({hiddenBuiltins.map((id) => BUILTIN_PRESETS[id]?.label).join(', ')})
          </button>
        )}
      </SectionCard>
      )}

      {tab === 'palette' && (
      <SectionCard id="palette" icon={Palette} title={`${GROUP_LABEL.brand} & ${GROUP_LABEL.ground}`}>
        {rolesIn('brand').map((r) => (
          <ColorField
            key={r.key}
            label={r.label}
            hint={r.hint}
            value={valueFor(r.key)}
            onChange={(v) => handleChange(keyFor(r.key), v)}
          />
        ))}

        <div style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)', color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
            {editing === 'light' ? <Sun size={13} /> : <Moon size={13} />}
            {editing === 'light' ? 'Light mode' : 'Dark mode'} page &amp; ink
          </div>
          {rolesIn('ground').map((r) => (
            <ColorField
              key={r.key}
              label={r.label}
              hint={r.hint}
              value={valueFor(r.key)}
              onChange={(v) => handleChange(keyFor(r.key), v)}
            />
          ))}
        </div>

        <div style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-5)', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
              Contrast — {editing} mode
            </span>
            <button type="button" className="glass-btn glass-btn-sm" onClick={copyToOtherMode}>
              <Sunrise size={12} /> Copy to {editing === 'light' ? 'dark' : 'light'}
            </button>
          </div>
          <ContrastScorecard settings={colors} mode={editing} onFix={fixContrast} />
        </div>

        {previewing && (
          <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', margin: '1rem 0 0' }}>
            You are previewing <strong style={{ color: 'var(--text)' }}>{editing}</strong> mode.
            The store is set to <strong style={{ color: 'var(--text)' }}>{savedMode}</strong> — saving keeps it that way.
          </p>
        )}
      </SectionCard>
      )}

      {tab === 'status' && (
      <SectionCard id="status" icon={Palette} title={GROUP_LABEL.status}>
        {rolesIn('status').map((r) => (
          <ColorField
            key={r.key}
            label={r.label}
            hint={r.hint}
            value={valueFor(r.key)}
            onChange={(v) => handleChange(keyFor(r.key), v)}
          />
        ))}
      </SectionCard>
      )}

      {tab === 'glow' && (
      <SectionCard id="glow" icon={Sparkles} title={GROUP_LABEL.glow}>
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '-0.4rem 0 1.1rem', lineHeight: 1.6 }}>
          Glow used to be locked to the primary colour, and the page background was always tinted by it.
          These are separate now: <strong style={{ color: 'var(--text)' }}>background tint</strong> colours the room,
          <strong style={{ color: 'var(--text)' }}> glow strength</strong> lights the furniture. Set the tint to 0 for a
          page that is exactly the colour you picked and nothing else.
        </p>
        {rolesIn('glow').map((r) => (
          <ColorField
            key={r.key}
            label={r.label}
            hint={r.hint}
            value={valueFor(r.key)}
            onChange={(v) => handleChange(keyFor(r.key), v)}
          />
        ))}
        {scalarsIn('glow').map((f) => (
          <SliderField
            key={f.key}
            label={f.label}
            hint={f.hint}
            unit={f.unit}
            min={f.min}
            max={f.max}
            step={f.step}
            value={parseFloat(colors[f.key] ?? f.default)}
            onChange={(v) => handleChange(f.key, v)}
          />
        ))}
      </SectionCard>
      )}

      {tab === 'glass' && (
      <SectionCard id="glass" icon={Droplets} title="Glass">
        {scalarsIn('glass').map((f) => (
          <SliderField
            key={f.key}
            label={f.label}
            hint={f.hint}
            unit={f.unit}
            min={f.min}
            max={f.max}
            step={f.step}
            value={parseFloat(colors[f.key] ?? f.default)}
            onChange={(v) => handleChange(f.key, v)}
          />
        ))}
        {/* The stage puts colour and a stripe field BEHIND the samples. On the
            flat admin background these sliders demonstrated nothing — blur of
            a uniform ground is invisible, which got the setting reported as
            broken — so the one place operators test glass now has something
            for the glass to do. */}
        <div className="theme-glass-stage" style={{ marginTop: 'var(--sp-4)' }}>
          <div className="theme-glass-samples">
            <div className="glass-card" style={{ display: 'inline-flex', gap: 'var(--sp-4)', padding: 'var(--sp-4) var(--sp-6)', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-base)' }}>Glass card</span>
              <span className="badge badge-primary">Badge</span>
            </div>
            <div className="glass-card" style={{ padding: 'var(--sp-4) var(--sp-6)', display: 'inline-flex', alignItems: 'center' }}>
              <span style={{ fontSize: 'var(--fs-base)', textShadow: 'var(--text-glow)', color: 'var(--primary)', fontWeight: 600 }}>
                Glow sample
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)', justifyContent: 'center' }}>
              <span className="theme-tier-chip tier-sm">sm · chips</span>
              <span className="theme-tier-chip tier-md">md · cards</span>
              <span className="theme-tier-chip tier-lg">lg · modals</span>
            </div>
          </div>
        </div>
      </SectionCard>
      )}

      {tab === 'shape' && (
      <SectionCard id="shape" icon={Squircle} title="Shape">
        {scalarsIn('shape').map((f) => (
          <SliderField
            key={f.key}
            label={f.label}
            hint={f.hint}
            unit={f.unit}
            min={f.min}
            max={f.max}
            step={f.step}
            value={parseFloat(colors[f.key] ?? f.default)}
            onChange={(v) => handleChange(f.key, v)}
          />
        ))}
        <div style={{ display: 'flex', gap: 'var(--sp-25)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--sp-2)' }}>
          <button className="glass-btn glass-btn-primary">Primary</button>
          <button className="glass-btn">Default</button>
          <input className="glass-input" placeholder="Input" style={{ margin: 0, maxWidth: 140 }} />
        </div>
      </SectionCard>
      )}

      {tab === 'type' && (
      <SectionCard id="type" icon={Type} title="Type">
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '-0.4rem 0 1.1rem', lineHeight: 1.6 }}>
          Three roles, every face vendored with the store — nothing loads from a CDN, so a buyer on a
          filtered network renders identically. The ledger face carries every price, id and timestamp;
          pick one whose digits you can read at 12px.
        </p>
        {FONT_KEYS.map((key) => {
          const group = fontGroupFor(key);
          const roster = FONT_ROSTER[group];
          const value = roster[colors[key]] ? colors[key] : DEFAULT_THEME[key];
          const roleLabel = group === 'ui' ? 'Working UI — controls, body, dense data'
            : group === 'display' ? 'Display — titles, headers, stat values'
              : 'Ledger — prices, ids, hashes, timestamps';
          const varName = group === 'ui' ? '--font' : group === 'display' ? '--font-display' : '--font-mono';
          const sample = group === 'display' ? 'Featured Products — Order #48,192'
            : group === 'mono' ? '$1,024.50 · bc1qxy2k…f3t4 · 2026-08-26 21:44'
              : 'Ships in plain packaging within 48 hours. 290 in stock.';
          return (
            <div className="form-group" key={key}>
              <label style={{ fontWeight: 600 }}>{roleLabel}</label>
              <select
                className="glass-input"
                value={value}
                onChange={(e) => handleChange(key, e.target.value)}
                aria-label={roleLabel}
              >
                {Object.entries(roster).map(([slug, f]) => (
                  <option key={slug} value={slug}>{f.label}</option>
                ))}
              </select>
              <div
                className="type-sample"
                style={{
                  fontFamily: `var(${varName})`,
                  fontWeight: group === 'display' ? 600 : 400,
                  fontSize: group === 'display' ? '1.05rem' : '0.9rem',
                  fontVariantNumeric: group === 'mono' ? 'tabular-nums' : undefined,
                }}
              >
                {sample}
              </div>
            </div>
          );
        })}
      </SectionCard>
      )}

      {tab === 'navbar' && (
      <SectionCard id="navbar" icon={LayoutPanelTop} title="Navigation bar">
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '-0.4rem 0 1.1rem', lineHeight: 1.6 }}>
          How the store&apos;s mark is presented in the bar at the top of every page.
        </p>

        <div className="navbar-preview">
          <div className="navbar-preview-bar">
            {liveSettings?.store_logo ? (
              colors.navbar_logo_dynamic_color === 'true' ? (
                <span
                  role="img"
                  aria-label="Logo preview"
                  className={`navbar-logo-img navbar-logo-${colors.navbar_logo_size || 'standard'} navbar-logo-dynamic`}
                  style={{ '--logo-src': `url("${liveSettings.store_logo}")` }}
                />
              ) : (
                <img
                  src={liveSettings.store_logo}
                  alt="Logo preview"
                  className={`navbar-logo-img navbar-logo-${colors.navbar_logo_size || 'standard'}`}
                />
              )
            ) : (
              <span className="navbar-preview-empty">
                <ImageIcon size={14} /> No logo uploaded — set one under Store settings
              </span>
            )}
            {colors.navbar_show_store_name === 'true' && liveSettings?.store_name && (
              <span className="navbar-wordmark">{liveSettings.store_name}</span>
            )}
            <span className="navbar-preview-search">Search products…</span>
          </div>
        </div>

        <div className="form-group" style={{ marginTop: 'var(--sp-4)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
            <Type size={13} /> Logo size
          </label>
          <div className="segmented" role="group" aria-label="Logo size">
            {LOGO_SIZES.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`segmented-option${(colors.navbar_logo_size || 'standard') === opt.value ? ' active' : ''}`}
                onClick={() => handleChange('navbar_logo_size', opt.value)}
                aria-pressed={(colors.navbar_logo_size || 'standard') === opt.value}
              >
                {opt.value === 'wide' ? <LayoutPanelTop size={14} /> : <ImageIcon size={14} />} {opt.label}
              </button>
            ))}
          </div>
          <small style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', display: 'block', marginTop: 'var(--sp-25)', lineHeight: 1.6 }}>
            {LOGO_SIZES.find((o) => o.value === (colors.navbar_logo_size || 'standard'))?.hint}
          </small>
        </div>

        <ToggleField
          label="Recolor logo"
          icon={Paintbrush}
          hint="Paints one color through the logo's own shape — the logo color below, or Primary while it's empty. For a flat single-color logo whose file color no longer matches the theme."
          enabled={colors.navbar_logo_dynamic_color === 'true'}
          onToggle={() => handleChange('navbar_logo_dynamic_color', colors.navbar_logo_dynamic_color === 'true' ? 'false' : 'true')}
        >
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--warning)', margin: 0, lineHeight: 1.6 }}>
            Only use this with a single-color logo on a transparent background. A photographic or
            multi-color logo will render as a solid silhouette, because only the shape survives.
          </p>
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <ColorField
              label={`Logo color — ${editing} mode`}
              hint="Leave empty to follow Primary"
              value={colors[keyFor('theme_logo_color')] || ''}
              onChange={(v) => handleChange(keyFor('theme_logo_color'), v)}
              badge={editing === 'light' ? <Sun size={12} /> : <Moon size={12} />}
            />
            <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: '-0.4rem 0 0', lineHeight: 1.6 }}>
              The mark used to be painted with the primary color, so tuning Primary for buttons
              silently recolored the logo too. Set a hex here to decouple them — per mode, since a
              mark that reads on near-black rarely reads on near-white. Clears back to Primary
              when emptied. Also drives the age-gate logo.
            </p>
          </div>
        </ToggleField>

        <ToggleField
          label="Show store name beside the logo"
          icon={Type}
          hint="Adds the store name as a wordmark next to the mark. Useful when the logo is a symbol with no text of its own. Hidden on narrow screens."
          enabled={colors.navbar_show_store_name === 'true'}
          onToggle={() => handleChange('navbar_show_store_name', colors.navbar_show_store_name === 'true' ? 'false' : 'true')}
        />
      </SectionCard>
      )}

      {tab === 'mobile' && (
      <SectionCard id="mobile" icon={Smartphone} title="Mobile & PWA">
        <ColorField
          label="Installed App Color"
          /*
           * Renamed because the old label was the one thing this control does
           * NOT do. It said "Mobile Chrome Color" / "Address bar tint", and
           * ThemeContext deliberately points the live `<meta name="theme-color">`
           * at the page background instead — with a comment explaining why:
           * pinning the address bar to a dark `pwa_theme_color` leaves a
           * near-black status bar above a white page in light mode. This key
           * reaches `manifest.theme_color` and nothing else, i.e. the chrome of
           * the app once it has been INSTALLED. CLAUDE.md: name things for what
           * they are — a label that describes a different control costs
           * somebody an afternoon.
           */
          hint="Chrome of the installed PWA, and its splash screen. The in-browser address bar follows the page background instead."
          value={colors.pwa_theme_color ?? DEFAULT_THEME.pwa_theme_color}
          onChange={(v) => handleChange('pwa_theme_color', v)}
        />

        <div className="form-group" style={{ marginTop: 'var(--sp-4)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
            <ImageIcon size={13} /> App icon
          </label>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 0.75rem', lineHeight: 1.6 }}>
            The square mark for home screens, browser tabs and the install dialog — separate from the
            store logo, because a logo is usually a wordmark and launchers crop wordmarks into
            unreadable slivers. Uploads are normalised onto an exact 512×512 transparent square,
            re-encoded to WebP, and stripped of <strong style={{ color: 'var(--text)' }}>every byte of
            metadata</strong> like all media here. Without one, the store logo stands in.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', flexWrap: 'wrap' }}>
            {(liveSettings?.pwa_icon || liveSettings?.store_logo) && (
              <img
                src={liveSettings?.pwa_icon || liveSettings?.store_logo}
                alt="App icon preview"
                style={{
                  width: 64, height: 64, objectFit: 'contain',
                  borderRadius: 14, border: '1px solid var(--border)',
                  background: 'var(--well)', padding: 4,
                }}
              />
            )}
            <label className="glass-btn glass-btn-sm" style={{ cursor: 'pointer' }}>
              <ImageIcon size={13} /> {pwaIconBusy ? 'Uploading…' : 'Upload icon'}
              <input
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                disabled={pwaIconBusy}
                onChange={(e) => uploadPwaIcon(e.target.files?.[0])}
              />
            </label>
            {liveSettings?.pwa_icon && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                Using the dedicated icon{liveSettings?.store_logo ? ' (logo no longer stretched into tiles)' : ''}.
              </span>
            )}
          </div>
        </div>
      </SectionCard>
      )}

      {/* ── Effects, one card per scope ─────────────────────────────────
          Two cards, each owning ONE engine at a time. They were a stack of
          canvas toggle rows plus a separate shader card, which let an operator
          run two full-viewport canvases and a fragment shader over each other
          — three compositing layers none of which can be read through — and
          made the two families look like different kinds of thing when they
          are the same kind of thing chosen two ways.

          The scopes stay independent: a shader background under a canvas
          constellation header is a perfectly good store, and the header is a
          60px strip whose cost has nothing to do with the field behind the
          page. See components/admin/EffectsCard.jsx. */}
      {tab === 'bg-effects' && (
      <SectionCard id="bg-effects" icon={Sparkles} title="Background effects">
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '-0.4rem 0 1.1rem', lineHeight: 1.6 }}>
          What paints behind every page. Everything here pauses on a hidden tab and renders a
          single still frame for visitors who have asked their system to reduce motion.
        </p>
        <EffectsCard
          scope="background"
          engine={colors.effects_bg_engine === 'webgl2' ? 'webgl2' : 'canvas'}
          onEngine={(v) => handleChange('effects_bg_engine', v)}
          canvasEffects={effectsFor('background')}
          shaderRoster={BACKGROUND_SHADERS}
          values={colors}
          onChange={handleChange}
          fallbacks={DEFAULT_THEME}
          ColorField={ColorField}
        />
      </SectionCard>
      )}

      {tab === 'header-effects' && (
      <SectionCard id="header-effects" icon={Radar} title="Header effects">
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '-0.4rem 0 1.1rem', lineHeight: 1.6 }}>
          Scoped to the nav bar — the one element on screen on every page, which is why nothing
          here is allowed to be loud. The constellation rests at nothing and only moves under a
          pointer; it never starts on a phone, where there is no pointer to answer.
        </p>
        <EffectsCard
          scope="header"
          engine={colors.effects_header_engine === 'webgl2' ? 'webgl2' : 'canvas'}
          onEngine={(v) => handleChange('effects_header_engine', v)}
          canvasEffects={effectsFor('header')}
          shaderRoster={HEADER_SHADERS}
          values={colors}
          onChange={handleChange}
          fallbacks={DEFAULT_THEME}
          ColorField={ColorField}
        />
      </SectionCard>
      )}

      {tab === 'preview' && (
      <SectionCard id="preview" title="Storefront preview">
        <ThemePreview settings={colors} storeName={liveSettings.store_name} onEditMode={(mode) => { previewMode(mode); setTab('palette'); }} />
      </SectionCard>
      )}
      </ThemeTabs>
      <NextStops route="/admin/theme" />
    </div>
  );
}
