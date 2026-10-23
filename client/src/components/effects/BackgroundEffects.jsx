import { useTheme } from '../../context/ThemeContext';
import SparklesEffect from '../SparklesEffect';
import SmokeEffect from '../SmokeEffect';
import AmbientCanvas from './AmbientCanvas';
import ShaderCanvas from './ShaderCanvas';
import { snowSpec, auroraSpec } from './specs';
// The shader LIBRARY is fetched only when one is selected — see useShaderSource.
import { useShaderSource } from './useShaderSource';

/**
 * Everything that paints behind the page, in one component.
 *
 * `Layout` and `AdminLayout` carried identical copies of this block, and the
 * copies were already the reason a change had to be made twice — adding the
 * shader slot meant editing both, and a third surface (the checkout receipt
 * page, a kiosk view) would have been a third chance to miss one. The rule for
 * what the store paints behind itself is one rule.
 *
 * ── One engine per scope ──────────────────────────────────────────────────
 *
 * The canvas family and the WebGL2 field are mutually exclusive, chosen by
 * `effects_bg_engine`. Two sparse canvases plus a fragment shader compositing
 * over each other costs three full-viewport layers for a result nobody can
 * read, and an interface that allows it invites it.
 *
 * The selector is a VIEW, not a destructive switch. Flipping to `webgl2` leaves
 * every canvas toggle exactly as it was, and flipping back restores the setup
 * without the operator having to rebuild it — which is what makes trying the
 * two against each other cheap.
 *
 * Within the canvas family the effects still STACK, and that is deliberate
 * rather than an oversight: they are sparse — a snowflake and a smoke cloud
 * genuinely can share a screen — where a shader fills every pixel by
 * definition. That difference is why one family is a multi-select and the
 * other is a picker.
 */
export default function BackgroundEffects() {
  const { settings } = useTheme();

  // Hooks run on every render, so the library request is decided by its
  // argument rather than by an early return: `null` asks for nothing.
  const engineIsShader = settings.effects_bg_engine === 'webgl2' && settings.effects_shader === 'true';
  const wantedName = engineIsShader && settings.effects_shader_name !== 'custom'
    ? settings.effects_shader_name
    : null;
  const built = useShaderSource('background', wantedName);

  // Anything other than the explicit 'webgl2' means canvas, including a value
  // absent from a store that predates the selector. Defaulting the OTHER way
  // would switch a shader on for every store that had never chosen one.
  const engine = settings.effects_bg_engine === 'webgl2' ? 'webgl2' : 'canvas';

  if (engine === 'webgl2') {
    if (settings.effects_shader !== 'true') return null;
    const name = settings.effects_shader_name;
    const source = name === 'custom'
      ? (settings.effects_shader_source || null)
      // `null` on the first render and until the library lands, which falls
      // through to the same render-nothing path as an unknown name.
      : (built?.source || null);
    // A `custom` slot with an empty box, or a stored name this build does not
    // know, renders nothing rather than falling back to some other field —
    // silently drawing an effect the operator did not pick is worse than
    // drawing none.
    if (!source) return null;
    return <ShaderCanvas source={source} colorKey="theme_shader_color" colorKey2="theme_shader_color_2" />;
  }

  return (
    <>
      {settings.effects_sparkles === 'true' && <SparklesEffect />}
      {settings.effects_smoke === 'true' && <SmokeEffect />}
      {settings.effects_snow === 'true' && <AmbientCanvas spec={snowSpec} />}
      {settings.effects_aurora === 'true' && <AmbientCanvas spec={auroraSpec} />}
    </>
  );
}
