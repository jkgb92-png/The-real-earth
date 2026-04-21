/**
 * packages/shaders/src/tile_sharpen.ts
 *
 * Texture sharpening for tile meshes — two complementary approaches:
 *
 * A) Standalone ShaderMaterial  (tileSharpenVertGlsl / tileSharpenFragGlsl)
 *    Use when you control the material entirely (custom PlaneGeometry tile mesh).
 *    Applies a 3×3 unsharp-mask sharpening kernel directly in the fragment
 *    shader and boosts RGB contrast with an S-curve.
 *
 * B) onBeforeCompile injection  (patchMaterialSharpening)
 *    Use when you want to keep MeshStandardMaterial PBR lighting but add
 *    sharpening on top.  Injects the unsharp-mask pass after the colour map
 *    is sampled, then applies an S-curve contrast boost before output.
 *
 * Sharpening parameters
 * ---------------------
 *  u_sharpness   [0 … 1]   Blend factor for the unsharp mask (default 0.45).
 *                           Values > 0.6 may introduce ringing on JPEG tiles.
 *  u_contrast    [0 … 1]   S-curve contrast lift (default 0.15).
 *  u_texelSize   vec2       1/textureWidth, 1/textureHeight — set from the
 *                           renderer's drawingBufferSize or the tile resolution.
 */

// ---------------------------------------------------------------------------
// A) Standalone ShaderMaterial GLSL
// ---------------------------------------------------------------------------

/**
 * Pass-through vertex shader for a flat tile PlaneGeometry.
 * Forwards UV coordinates to the fragment shader.
 */
export const tileSharpenVertGlsl = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment shader for the standalone tile ShaderMaterial.
 *
 * Applies:
 *  1. 3×3 unsharp-mask sharpening (controlled by u_sharpness).
 *  2. RGB S-curve contrast boost   (controlled by u_contrast).
 *
 * Uniforms:
 *  map          sampler2D  — the tile texture
 *  u_texelSize  vec2       — vec2(1/w, 1/h) of the tile texture
 *  u_sharpness  float      — [0,1] default 0.45
 *  u_contrast   float      — [0,1] default 0.15
 */
export const tileSharpenFragGlsl = /* glsl */ `
uniform sampler2D map;
uniform vec2      u_texelSize;
uniform float     u_sharpness;
uniform float     u_contrast;

varying vec2 vUv;

// ---------------------------------------------------------------------------
// 3×3 Unsharp-Mask Sharpening Kernel
//
// kernel:   0  -1   0
//          -1   5  -1
//           0  -1   0
//
// Result: sharp(uv) = 5 * center - (N + S + E + W)
// Blended with the original at u_sharpness weight.
// ---------------------------------------------------------------------------
vec3 sharpen(vec2 uv) {
    vec3 center = texture2D(map, uv).rgb;
    vec3 north  = texture2D(map, uv + vec2( 0.0,  u_texelSize.y)).rgb;
    vec3 south  = texture2D(map, uv + vec2( 0.0, -u_texelSize.y)).rgb;
    vec3 east   = texture2D(map, uv + vec2( u_texelSize.x,  0.0)).rgb;
    vec3 west   = texture2D(map, uv + vec2(-u_texelSize.x,  0.0)).rgb;

    vec3 sharpened = 5.0 * center - (north + south + east + west);
    return mix(center, clamp(sharpened, 0.0, 1.0), u_sharpness);
}

// ---------------------------------------------------------------------------
// S-Curve RGB Contrast
// Maps [0,1] → [0,1] with a soft S-shape that lifts mid-tone contrast.
// u_contrast = 0 → identity; u_contrast = 1 → maximum S-curve lift.
// ---------------------------------------------------------------------------
vec3 contrastBoost(vec3 col, float amount) {
    // Remaps x via smoothstep-based S-curve, then lerps toward it.
    vec3 sc = smoothstep(vec3(0.0), vec3(1.0), col);
    sc = sc * sc * (3.0 - 2.0 * sc); // double-smoothstep for steeper S
    return mix(col, sc, amount);
}

void main() {
    vec3 col = sharpen(vUv);
    col = contrastBoost(col, u_contrast);
    gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// B) onBeforeCompile patcher for MeshStandardMaterial
// ---------------------------------------------------------------------------

/**
 * GLSL snippet injected after `#include <map_fragment>` in Three.js's
 * MeshStandardMaterial fragment shader.
 *
 * It re-samples the map at the four cardinal neighbours, applies the
 * unsharp-mask kernel, and then applies the S-curve contrast boost to
 * `diffuseColor.rgb` before it flows into the PBR lighting calculation.
 *
 * Uniforms injected by patchMaterialSharpening:
 *  u_texelSize  vec2   — 1/mapWidth, 1/mapHeight
 *  u_sharpness  float  — [0,1] default 0.45
 *  u_contrast   float  — [0,1] default 0.15
 */
const SHARPEN_INJECTION = /* glsl */ `
// ── Tile Sharpening Injection ────────────────────────────────────────────────
#ifdef USE_MAP
{
    vec3 _center = diffuseColor.rgb;

    vec3 _north  = texture2D(map, vMapUv + vec2( 0.0,           u_texelSize.y)).rgb;
    vec3 _south  = texture2D(map, vMapUv + vec2( 0.0,          -u_texelSize.y)).rgb;
    vec3 _east   = texture2D(map, vMapUv + vec2( u_texelSize.x,  0.0         )).rgb;
    vec3 _west   = texture2D(map, vMapUv + vec2(-u_texelSize.x,  0.0         )).rgb;

    // 3×3 unsharp-mask (4-connected kernel, centre weight = 5)
    vec3 _sharp  = 5.0 * _center - (_north + _south + _east + _west);
    vec3 _mixed  = mix(_center, clamp(_sharp, 0.0, 1.0), u_sharpness);

    // S-curve contrast boost
    vec3 _sc     = _mixed * _mixed * (3.0 - 2.0 * _mixed);
    diffuseColor.rgb = mix(_mixed, _sc, u_contrast);
}
#endif
// ── End Tile Sharpening Injection ────────────────────────────────────────────
`;

/** Uniform declarations prepended to the fragment shader header. */
const SHARPEN_UNIFORMS_GLSL = /* glsl */ `
uniform vec2  u_texelSize;
uniform float u_sharpness;
uniform float u_contrast;
`;

/**
 * Options for patchMaterialSharpening.
 *
 * All values are optional — defaults produce a visible but conservative
 * sharpening appropriate for 512 px GIBS / Sentinel-2 tiles.
 */
export interface SharpeningOptions {
  /**
   * Unsharp-mask blend weight [0,1].
   * 0 = no sharpening, 1 = full kernel output.
   * @default 0.45
   */
  sharpness?: number;
  /**
   * S-curve contrast boost [0,1].
   * 0 = no contrast change, 1 = maximum S-curve.
   * @default 0.15
   */
  contrast?: number;
  /**
   * Texel size in UV space: vec2(1/mapWidth, 1/mapHeight).
   * If omitted, defaults to 1/512 (matches 512 px tile resolution).
   * @default [1/512, 1/512]
   */
  texelSize?: [number, number];
}

/**
 * Duck-typed subset of a Three.js material that supports onBeforeCompile.
 * A real THREE.MeshStandardMaterial satisfies this interface.
 */
export interface PatchableMaterial {
  onBeforeCompile: (shader: {
    uniforms: Record<string, { value: unknown }>;
    fragmentShader: string;
  }) => void;
  needsUpdate: boolean;
}

/**
 * Patch a MeshStandardMaterial (or any material with onBeforeCompile) to add
 * tile texture sharpening and contrast in the fragment shader.
 *
 * The patch is non-destructive: if the `#include <map_fragment>` token is not
 * found (e.g. the material has no map), the fragment shader is left unmodified.
 *
 * @param material  The material to patch (must support onBeforeCompile).
 * @param opts      Optional sharpening parameters — see SharpeningOptions.
 *
 * @example
 * ```ts
 * import { patchMaterialSharpening } from '@the-real-earth/shaders';
 *
 * const mat = new THREE.MeshStandardMaterial({ map: tileTexture });
 * patchMaterialSharpening(mat, { sharpness: 0.5, contrast: 0.2 });
 * ```
 */
export function patchMaterialSharpening(
  material: PatchableMaterial,
  opts: SharpeningOptions = {},
): void {
  const sharpness = opts.sharpness ?? 0.45;
  const contrast = opts.contrast ?? 0.15;
  const [tx, ty] = opts.texelSize ?? [1 / 512, 1 / 512];

  material.onBeforeCompile = (shader) => {
    // Inject uniform declarations into the fragment shader header.
    shader.fragmentShader = SHARPEN_UNIFORMS_GLSL + shader.fragmentShader;

    // Inject sharpening code after the map colour is sampled.
    // `#include <map_fragment>` is the canonical Three.js injection point for
    // custom colour operations that feed into the PBR diffuse term.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n' + SHARPEN_INJECTION,
    );

    // Register uniform values.
    shader.uniforms['u_texelSize'] = { value: [tx, ty] };
    shader.uniforms['u_sharpness'] = { value: sharpness };
    shader.uniforms['u_contrast'] = { value: contrast };
  };

  // Force Three.js to recompile the shader program with the new callback.
  material.needsUpdate = true;
}
