/**
 * The GLSL half of the WebGL2 engine: the vertex stage, the uniform preamble
 * every fragment shader is compiled behind, and the compile/link path.
 *
 * A plain module rather than part of ShaderCanvas.jsx, and the reason is the
 * test suite: node cannot import `.jsx`, so the wrapper could not be checked
 * without a browser while it lived beside the component. It is also honest
 * separation — none of this is React, and the admin editor's preview and the
 * storefront's field both want the same compile path.
 */

/** The vertex stage every effect shares. No attributes, no buffers. */
const VERTEX_SRC = `#version 300 es
precision highp float;
out vec2 uv;
void main() {
  // Three vertices covering clip space: (-1,-1), (3,-1), (-1,3).
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * The preamble every fragment shader — built-in or operator-written — is
 * compiled with.
 *
 * It exists so a custom shader is a few lines rather than a program. Somebody
 * pasting a shader in from a sketchpad expects `iResolution`, `iTime` and a
 * `mainImage` entry point, so those are the names, and the store's own
 * palette arrives as `uColor` and `uColor2` — which is what keeps an
 * operator-written effect on-theme instead of hard-coding a hue the way every
 * shader found in the wild does.
 *
 * `uAlpha` is the fade the engine owns. A shader that ignores it still works;
 * one that multiplies by it gets the hover fade and the reduced-motion still
 * frame for free.
 */
export const SHADER_PREAMBLE = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 fragColor;
uniform vec2  iResolution;
uniform float iTime;
uniform vec2  iMouse;
uniform vec3  uColor;
uniform vec3  uColor2;
uniform float uAlpha;
uniform float uIsLight;
`;

/** Wrap a `mainImage(out vec4, in vec2)` body the way the sketchpads write it. */
export function wrapShader(source) {
  const src = String(source || '');
  // A shader that declares its own `main` is used as written — an operator who
  // wants full control of the entry point should have it. One that only
  // defines `mainImage` gets the shim, which is the shape every shader posted
  // on the internet has.
  const hasMain = /\bvoid\s+main\s*\(/.test(src);
  // `gl_FragCoord.xy`, not `uv * iResolution`, and the difference only shows
  // up on a phone.
  //
  // `uv` is a varying: the rasteriser interpolates it across the triangle and
  // the fragment stage receives whatever precision that interpolator has.
  // Desktop drivers carry varyings at fp32 and the two expressions agree to
  // the last bit, which is why the original shape looked correct for as long
  // as nobody opened the store on a phone. Mobile GPUs are entitled to far
  // less — GLSL ES only promises `highp` a 2^-16 relative precision, and
  // several drivers interpolate at fp16 regardless of the declaration — so
  // `uv` arrived quantised, and multiplying a quantised 0..1 by a resolution
  // of 1218 turned the quantisation into whole pixels. Every field that keys
  // off a cell index then read the SAME index across bands of the screen: the
  // patterns broke into blocks, seams appeared where a band boundary fell, and
  // the noise-driven ones collapsed to flat nothing.
  //
  // `gl_FragCoord` is not interpolated and GLSL ES 3.00 declares it `highp`,
  // so the fragment's own pixel centre is exact on every conformant device.
  // It is also literally what the sketchpads mean by `fragCoord`.
  //
  // `uv` stays declared in the preamble: an operator shader may already use
  // it, and it is the right thing for anything that genuinely wants 0..1.
  const tail = hasMain ? '' : `
void main() {
  vec4 c = vec4(0.0);
  mainImage(c, gl_FragCoord.xy);
  fragColor = vec4(c.rgb, c.a * uAlpha);
}`;
  return `${SHADER_PREAMBLE}\n${src}\n${tail}`;
}

function compile(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) || 'shader failed to compile';
    gl.deleteShader(sh);
    return { error: log };
  }
  return { shader: sh };
}

/**
 * Build a program, reporting a compile failure rather than throwing.
 *
 * An operator writing GLSL in a textarea WILL paste something that does not
 * compile, and the storefront must not go blank because of it. The failure is
 * returned so the editor can print the driver's own error — which is the only
 * useful thing to show someone debugging a shader — and the store renders with
 * no effect at all, which is exactly what it looked like before they started.
 */
export function buildProgram(gl, fragmentSource) {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  if (vs.error) return { error: vs.error };
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (fs.error) {
    gl.deleteShader(vs.shader);
    return { error: fs.error };
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, vs.shader);
  gl.attachShader(prog, fs.shader);
  gl.linkProgram(prog);
  gl.deleteShader(vs.shader);
  gl.deleteShader(fs.shader);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(prog) || 'shader failed to link';
    gl.deleteProgram(prog);
    return { error: log };
  }
  return { program: prog };
}
