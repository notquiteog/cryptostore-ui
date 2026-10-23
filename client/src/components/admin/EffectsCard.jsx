import { useState, useMemo } from 'react';
import {
  Cpu, Brush, AlertTriangle, RotateCcw, Code2, Eye, EyeOff, Check,
} from 'lucide-react';
import { STARTER_SHADER } from '../effects/shaders';
import ShaderCanvas from '../effects/ShaderCanvas';

/**
 * One scope's ambient effects — background or header — as a single card with
 * an engine switch at the top.
 *
 * ── What this replaced ────────────────────────────────────────────────────
 *
 * A stack of independent toggle rows for the canvas effects, and a separate
 * card underneath for the shader. Two problems with that, and the second is
 * the one that mattered:
 *
 *   - Nothing said the two families were alternatives. An operator could
 *     switch on smoke, snow AND a fragment shader, which is three
 *     full-viewport layers compositing over each other for a result none of
 *     them can be read through. An interface that allows it invites it.
 *   - The canvas effects and the shader looked like different KINDS of
 *     thing — a list of switches versus a card with a picker — when they are
 *     the same kind of thing chosen two ways.
 *
 * Now: one card, an engine segmented control, and whichever family is selected
 * renders below it in the same shape. The switch is a VIEW rather than a
 * destructive change — flipping to WebGL2 leaves every canvas toggle where it
 * was, and flipping back restores the setup — so trying the two against each
 * other costs nothing.
 *
 * ── Why canvas is multi-select and WebGL2 is a picker ─────────────────────
 *
 * Not an inconsistency. Canvas effects are SPARSE — a snowflake and a smoke
 * cloud genuinely can share a screen, and the roster was built for that — while
 * a fragment shader fills every pixel by definition. The chips behave the way
 * the underlying thing behaves, and the card says which it is doing.
 */
export default function EffectsCard({
  scope,            // 'background' | 'header'
  engine,           // 'canvas' | 'webgl2'
  onEngine,
  canvasEffects,    // [{ toggleKey, colorKey, label, colorLabel, hint, colorHint, icon }]
  shaderRoster,
  values,           // the editor's draft settings
  onChange,         // (key, value) => void
  fallbacks,        // DEFAULT_THEME, for keys the draft has not touched
  ColorField,       // the editor's own field, passed in rather than re-imported
}) {
  const [showPreview, setShowPreview] = useState(true);
  const [error, setError] = useState(null);

  const isHeader = scope === 'header';
  const keys = isHeader
    ? {
      on: 'effects_header_shader',
      name: 'effects_header_shader_name',
      source: 'effects_header_shader_source',
      colour: 'theme_header_shader_color',
      colour2: 'theme_header_shader_color_2',
    }
    : {
      on: 'effects_shader',
      name: 'effects_shader_name',
      source: 'effects_shader_source',
      colour: 'theme_shader_color',
      colour2: 'theme_shader_color_2',
    };

  const val = (k) => values[k] ?? fallbacks[k];
  const shaderOn = values[keys.on] === 'true';
  const name = val(keys.name);
  const isCustom = name === 'custom';
  const built = shaderRoster[name];
  // The starter is shown when the box is empty rather than written into the
  // setting: switching to custom and back should not silently save a shader
  // nobody looked at.
  const effective = isCustom ? (values[keys.source] || STARTER_SHADER) : (built?.source || '');

  // Keyed so a changed source remounts the canvas instead of swapping a program
  // under a running loop. Cheap — one triangle — and it is what makes a compile
  // error clear itself when the source is fixed.
  const previewKey = useMemo(
    () => `${name}:${effective.length}:${effective.slice(0, 64)}`,
    [name, effective],
  );

  const canvasOnCount = canvasEffects.filter((fx) => values[fx.toggleKey] === 'true').length;

  return (
    <div className="fx-card">
      {/* The switch, and the count of what each side is currently running. The
          counts are what stop the inactive family being invisible: an operator
          on WebGL2 can see they still have two canvas effects waiting, so
          switching back is an informed move rather than a surprise. */}
      <div className="fx-engine-switch" role="radiogroup" aria-label={`${scope} effect engine`}>
        <button
          type="button"
          role="radio"
          aria-checked={engine === 'canvas'}
          className={`fx-engine-opt${engine === 'canvas' ? ' is-on' : ''}`}
          onClick={() => onEngine('canvas')}
        >
          <Brush size={14} aria-hidden="true" />
          <span>Canvas</span>
          {canvasOnCount > 0 && <span className="fx-engine-count">{canvasOnCount}</span>}
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={engine === 'webgl2'}
          className={`fx-engine-opt${engine === 'webgl2' ? ' is-on' : ''}`}
          onClick={() => onEngine('webgl2')}
        >
          <Cpu size={14} aria-hidden="true" />
          <span>WebGL2</span>
          {shaderOn && <span className="fx-engine-count"><Check size={10} aria-hidden="true" /></span>}
        </button>
      </div>

      <p className="fx-note">
        {engine === 'canvas'
          ? (isHeader
            ? 'A 2D canvas over the nav bar. Runs anywhere a browser draws — no GPU requirement.'
            : 'Particle systems on a 2D canvas. These stack, because they are sparse; each still costs a little battery, so two at most is a kindness to phones.')
          : (isHeader
            ? 'A fragment shader across the nav bar. Renders nothing at all on a browser with no WebGL2 — an old build, a blocked GPU, a hardened profile.'
            : 'A fragment shader across the whole viewport. One at a time: unlike the sparse canvas effects, a shader fills every pixel. Renders nothing where there is no WebGL2.')}
        {' '}
        <span className="fx-note-quiet">
          Switching engines changes what runs, never what you have set up — the other side keeps its
          settings and comes back exactly as you left it.
        </span>
      </p>

      {engine === 'canvas' ? (
        <div className="fx-body">
          {/* Chips, and they toggle rather than select: see the header comment
              for why this family stacks where the shader does not. */}
          <div className="fx-chips">
            {canvasEffects.map((fx) => {
              const on = values[fx.toggleKey] === 'true';
              const Icon = fx.icon;
              return (
                <button
                  key={fx.toggleKey}
                  type="button"
                  aria-pressed={on}
                  className={`fx-chip${on ? ' is-on' : ''}`}
                  onClick={() => onChange(fx.toggleKey, on ? 'false' : 'true')}
                  title={fx.hint}
                >
                  {Icon && <Icon size={12} aria-hidden="true" />} {fx.label}
                </button>
              );
            })}
          </div>

          {canvasOnCount === 0 ? (
            <p className="fx-note fx-note-quiet" style={{ margin: 0 }}>
              Nothing running. Pick one above — each has a colour once it is on.
            </p>
          ) : (
            /* Only the colours of what is actually on. Rendering all four
               regardless made the card a wall of pickers for effects nobody had
               switched on, which is DESIGN §7's "every control must justify its
               pixels" read literally. */
            canvasEffects.filter((fx) => values[fx.toggleKey] === 'true').map((fx) => (
              <ColorField
                key={fx.colorKey}
                label={`${fx.colorLabel} colour`}
                hint={fx.colorHint}
                value={val(fx.colorKey)}
                onChange={(v) => onChange(fx.colorKey, v)}
              />
            ))
          )}
        </div>
      ) : (
        <div className="fx-body">
          <label className="fx-switch">
            <input
              type="checkbox"
              checked={shaderOn}
              onChange={(e) => onChange(keys.on, e.target.checked ? 'true' : 'false')}
            />
            Run a shader {isHeader ? 'on the nav bar' : 'behind the store'}
          </label>

          {shaderOn && (
            <>
              <div className="fx-chips" role="radiogroup" aria-label="Which shader">
                {Object.entries(shaderRoster).map(([key, fx]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={name === key}
                    className={`fx-chip${name === key ? ' is-on' : ''}`}
                    onClick={() => onChange(keys.name, key)}
                    title={fx.hint}
                  >
                    {fx.label}
                  </button>
                ))}
                <button
                  type="button"
                  role="radio"
                  aria-checked={isCustom}
                  className={`fx-chip${isCustom ? ' is-on' : ''}`}
                  onClick={() => onChange(keys.name, 'custom')}
                  title="Write your own GLSL"
                >
                  <Code2 size={12} aria-hidden="true" /> Write my own
                </button>
              </div>

              {built?.hint && !isCustom && <p className="fx-note fx-note-quiet">{built.hint}</p>}

              {/* BOTH colours, and the second one is the fix for a real bug.
                  Every field mixes uColor and uColor2 across its own gradient,
                  so a card with one picker left half of every pixel decided by
                  a palette key three sections away — which made the shader's
                  own colour control look like it did almost nothing. */}
              <ColorField
                label="Shader colour"
                hint="Reaches the shader as uColor."
                value={val(keys.colour)}
                onChange={(v) => onChange(keys.colour, v)}
              />
              <ColorField
                label="Second colour"
                hint="Reaches the shader as uColor2. Every built-in field mixes the two across its own gradient, so this one decides as much of what you see as the first."
                value={val(keys.colour2)}
                onChange={(v) => onChange(keys.colour2, v)}
              />

              {isCustom && (
                <div className="fx-editor">
                  <div className="fx-editor-head">
                    <label htmlFor={`glsl-${scope}`}>Fragment shader</label>
                    <button
                      type="button"
                      className="glass-btn glass-btn-sm"
                      onClick={() => onChange(keys.source, STARTER_SHADER)}
                      title="Replace the box with the starter shader"
                    >
                      <RotateCcw size={12} aria-hidden="true" /> Starter
                    </button>
                  </div>
                  <textarea
                    id={`glsl-${scope}`}
                    className="glass-input fx-code"
                    value={values[keys.source] || STARTER_SHADER}
                    onChange={(e) => onChange(keys.source, e.target.value)}
                    rows={14}
                    spellCheck="false"
                    autoCapitalize="off"
                    autoCorrect="off"
                    wrap="off"
                  />
                  <p className="fx-note fx-note-quiet">
                    Write a <code>mainImage(out vec4, in vec2)</code>, or your own <code>main()</code>{' '}
                    for full control. <code>iResolution</code>, <code>iTime</code>,{' '}
                    <code>iMouse</code>, <code>uColor</code>, <code>uColor2</code> and{' '}
                    <code>uIsLight</code> are declared for you. Keep the alpha low — this draws over
                    your background rather than replacing it.
                  </p>
                </div>
              )}

              {error && (
                <div className="fx-error" role="alert">
                  <span className="fx-error-head">
                    <AlertTriangle size={13} aria-hidden="true" /> This shader did not compile
                  </span>
                  {/* Verbatim. A GLSL error names a line and a token, and that
                      is the whole value of it. */}
                  <pre>{error}</pre>
                </div>
              )}

              <div className="fx-preview-row">
                <button
                  type="button"
                  className="glass-btn glass-btn-sm"
                  onClick={() => setShowPreview((v) => !v)}
                >
                  {showPreview ? <><EyeOff size={12} /> Hide preview</> : <><Eye size={12} /> Show preview</>}
                </button>
                <span className="fx-note fx-note-quiet" style={{ margin: 0 }}>
                  Running live against your unsaved settings.
                </span>
              </div>

              {showPreview && (
                <div className="fx-preview">
                  {/* The stage carries the store's own ground so the field is
                      composited over what it will actually sit on — judging a
                      low-alpha effect against the admin panel's surface is
                      judging it against the wrong background. */}
                  <ShaderCanvas
                    key={previewKey}
                    source={effective}
                    colorKey={keys.colour}
                    colorKey2={keys.colour2}
                    pointer={isHeader}
                    position="absolute"
                    onStatus={setError}
                  />
                  <span className="fx-preview-label">preview</span>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
