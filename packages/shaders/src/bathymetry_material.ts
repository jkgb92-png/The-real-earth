/**
 * packages/shaders/src/bathymetry_material.ts
 *
 * PBR material settings and fragment-shader injection for ocean-floor
 * bathymetry meshes (sonar-track / ridge visualisation).
 *
 * Problem: default MeshStandardMaterial roughness of 1.0 makes the surface
 * look uniformly diffuse — specular highlights are too broad to distinguish
 * the narrow ridges and sonar track boundaries in the bathymetry data.
 *
 * Solution:
 *  - Low roughness (0.18) → tight, well-defined specular lobe so light
 *    catches the ridges of each sonar swath sharply.
 *  - Very low metalness (0.04) → keeps the surface non-metallic (ocean
 *    sediment/basalt) while still allowing the PBR specular model to fire.
 *  - Fragment injection → amplifies the PBR specular term for pixels whose
 *    normal map points steeply toward the light (ridge peaks), and adds a
 *    faint sonar-blue tint for depth cueing.
 *
 * Usage
 * -----
 *   import { BATHYMETRY_MATERIAL, applyBathymetryShading } from '@the-real-earth/shaders';
 *
 *   // Option A — set params on an existing material
 *   material.roughness = BATHYMETRY_MATERIAL.roughness;
 *   material.metalness = BATHYMETRY_MATERIAL.metalness;
 *
 *   // Option B — apply params + fragment injection (preferred)
 *   applyBathymetryShading(material);
 */

// ---------------------------------------------------------------------------
// Material parameter constants
// ---------------------------------------------------------------------------

/**
 * Recommended PBR parameters for ocean-floor bathymetry meshes.
 *
 * roughness 0.18 → specular highlight FWHM ≈ 8°, giving crisp ridge edges.
 * metalness 0.04 → near-dielectric; retains the Fresnel rim without turning
 *                  the surface metallic (which would incorrectly tint it with
 *                  the albedo map colour in the specular lobe).
 * envMapIntensity 0.6 → moderate IBL contribution from the skybox; too high
 *                        and the ridge contrast washes out.
 */
export const BATHYMETRY_MATERIAL = {
  roughness: 0.18,
  metalness: 0.04,
  envMapIntensity: 0.6,
} as const;

// ---------------------------------------------------------------------------
// Fragment shader injection
// ---------------------------------------------------------------------------

/**
 * Uniform declarations for the bathymetry shading injection.
 * These are prepended to the fragment shader so Three.js links them correctly.
 */
const BATHYMETRY_UNIFORMS_GLSL = /* glsl */ `
uniform float u_ridgeSharpness;   // [0,1]  default 0.7
uniform float u_ridgeEmissive;    // [0,∞]  default 0.35
uniform vec3  u_sonarTint;        // RGB    default vec3(0.15, 0.55, 0.85)
`;

/**
 * GLSL fragment injection for bathymetry ridge enhancement.
 *
 * Injected after `#include <normal_fragment_maps>` (where the final surface
 * normal has been computed from the normal map) and before the lighting loop.
 *
 * Effect:
 *  1. Reads the interpolated surface normal after normal-map perturbation.
 *  2. Computes a "ridginess" factor — how steeply the normal deviates from
 *     the base mesh normal (high deviation → ridge peak or canyon wall).
 *  3. Adds an emissive sonar-blue rim to ridge peaks, proportional to u_ridgeEmissive.
 *  4. Multiplies roughness down further at ridge peaks so the specular lobe
 *     narrows exactly where we need sharpest definition.
 *
 * Uniforms (injected by applyBathymetryShading):
 *  u_ridgeSharpness  float  — ridge detection sensitivity [0,1], default 0.7
 *  u_ridgeEmissive   float  — emissive intensity at ridges [0,∞], default 0.35
 *  u_sonarTint       vec3   — sonar accent colour, default deep sonar blue
 */
const BATHYMETRY_INJECTION = /* glsl */ `
// ── Bathymetry Ridge Enhancement Injection ───────────────────────────────────
{
    // vNormal = interpolated geometric normal (pre-normal-map).
    // normal  = perturbed normal-map normal in view space (available after
    //           the normal_fragment_maps include).
    // Ridge factor: large when the normal-map deflects strongly from the
    // geometry normal — i.e. the surface is a steep ridge wall or peak.
    float _ridgeFactor = 1.0 - clamp(dot(normal, vNormal), 0.0, 1.0);
    _ridgeFactor       = pow(_ridgeFactor, mix(4.0, 1.5, u_ridgeSharpness));

    // Narrow the specular lobe at ridges: multiply roughness down so PBR
    // generates a crisp highlight exactly on the ridge edge.
    // roughnessFactor is the working roughness used by the lighting loop.
    roughnessFactor = max(roughnessFactor * (1.0 - _ridgeFactor * 0.72), 0.04);

    // Add sonar-tinted emissive glow at ridge peaks.
    totalEmissiveRadiance += u_sonarTint * (_ridgeFactor * u_ridgeEmissive);
}
// ── End Bathymetry Ridge Enhancement Injection ───────────────────────────────
`;

/**
 * Duck-typed subset of a Three.js material that supports onBeforeCompile.
 * A real THREE.MeshStandardMaterial satisfies this interface.
 */
export interface BathymetryMaterial {
  roughness: number;
  metalness: number;
  envMapIntensity?: number;
  onBeforeCompile: (shader: {
    uniforms: Record<string, { value: unknown }>;
    fragmentShader: string;
  }) => void;
  needsUpdate: boolean;
}

/**
 * Options for the ridge enhancement pass.
 */
export interface BathymetryOptions {
  /**
   * Ridge detection sensitivity: higher = more ridges detected.
   * @default 0.7
   */
  ridgeSharpness?: number;
  /**
   * Emissive intensity at ridge peaks (sonar-blue glow).
   * 0 = no glow, 1+ = very bright.
   * @default 0.35
   */
  ridgeEmissive?: number;
  /**
   * RGB accent colour for the sonar-ridge glow.
   * @default [0.15, 0.55, 0.85]  (deep sonar blue)
   */
  sonarTint?: [number, number, number];
}

/**
 * Apply bathymetry PBR params and ridge-enhancement fragment injection to a
 * MeshStandardMaterial (or any material with onBeforeCompile).
 *
 * Sets roughness, metalness, and envMapIntensity from BATHYMETRY_MATERIAL,
 * then hooks onBeforeCompile to inject the ridge-sharpening pass.
 *
 * @param material  MeshStandardMaterial-compatible material to configure.
 * @param opts      Optional ridge shading parameters.
 *
 * @example
 * ```ts
 * import { applyBathymetryShading } from '@the-real-earth/shaders';
 *
 * const mat = new THREE.MeshStandardMaterial({
 *   map:       bathyColorTex,
 *   normalMap: bathyNormalTex,
 * });
 * applyBathymetryShading(mat, { ridgeSharpness: 0.75, ridgeEmissive: 0.4 });
 * scene.add(new THREE.Mesh(bathyGeo, mat));
 * ```
 */
export function applyBathymetryShading(
  material: BathymetryMaterial,
  opts: BathymetryOptions = {},
): void {
  const ridgeSharpness = opts.ridgeSharpness ?? 0.7;
  const ridgeEmissive = opts.ridgeEmissive ?? 0.35;
  const sonarTint = opts.sonarTint ?? [0.15, 0.55, 0.85];

  // Apply PBR base params.
  material.roughness = BATHYMETRY_MATERIAL.roughness;
  material.metalness = BATHYMETRY_MATERIAL.metalness;
  if ('envMapIntensity' in material) {
    material.envMapIntensity = BATHYMETRY_MATERIAL.envMapIntensity;
  }

  material.onBeforeCompile = (shader) => {
    // Prepend uniform declarations.
    shader.fragmentShader = BATHYMETRY_UNIFORMS_GLSL + shader.fragmentShader;

    // Inject ridge enhancement after normal-map vectors are resolved.
    // `#include <normal_fragment_maps>` is the standard Three.js injection
    // point where both `normal` (perturbed) and `vNormal` (geometric) are
    // available in view space.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      '#include <normal_fragment_maps>\n' + BATHYMETRY_INJECTION,
    );

    shader.uniforms['u_ridgeSharpness'] = { value: ridgeSharpness };
    shader.uniforms['u_ridgeEmissive'] = { value: ridgeEmissive };
    shader.uniforms['u_sonarTint'] = { value: sonarTint };
  };

  material.needsUpdate = true;
}
