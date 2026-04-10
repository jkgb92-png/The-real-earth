/**
 * packages/shaders/src/index.ts
 *
 * Exports GLSL shader source strings and CesiumJS integration helpers.
 */

// Inline the GLSL at build time so consumers don't need a file-loader.
// Enhanced with limb brightening and chromatic sunset dispersion.
export const rayleighShader = /* glsl */ `
uniform sampler2D colorTexture;

// Camera altitude in metres above the ellipsoid surface.
uniform float altitude;

in vec2 v_textureCoordinates;

void main() {
    vec4 color = texture(colorTexture, v_textureCoordinates);

    // Rayleigh scale height ~8500 m — scattering diminishes exponentially.
    // Guard against altitude ≤ 0 (camera below ellipsoid at init or deep zoom)
    // which would make exp() return > 1 and extrapolate colors out of range.
    float scatter = exp(-max(altitude, 0.0) / 8500.0);

    // Primary blue-sky scatter colour.
    vec3 blueScatter = vec3(0.18, 0.36, 0.72);

    // Limb brightening: amplify atmosphere near the screen horizon.
    vec2 uv = v_textureCoordinates * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    float limb = smoothstep(0.5, 1.0, r2) * 0.5;

    // Chromatic sunset: blend warm reddish-orange at low altitudes along
    // horizontal bands (approximates terminator zone sunrise/sunset colours).
    float sunsetFactor = scatter * (1.0 - abs(uv.y)) * 0.6;
    vec3 sunsetColor = vec3(0.85, 0.45, 0.12);

    // Combine: scatter, limb halo, and sunset dispersion.
    vec3 atmo = mix(blueScatter, sunsetColor, clamp(sunsetFactor * 0.4, 0.0, 0.5));
    color.rgb = mix(color.rgb, atmo, scatter * 0.38 + limb * 0.25);

    out_FragColor = color;
}
`;

/**
 * Creates a CesiumJS PostProcessStage configuration object for the enhanced
 * Rayleigh atmospheric scattering shader (limb brightening + chromatic sunset).
 *
 * @param getAltitude  Function that returns the camera altitude in metres.
 *                     Typically: () => viewer.camera.positionCartographic.height
 *
 * @example
 * import { createRayleighStage } from '@the-real-earth/shaders';
 * viewer.postProcessStages.add(
 *   new Cesium.PostProcessStage(
 *     createRayleighStage(() => viewer.camera.positionCartographic.height)
 *   )
 * );
 */
export function createRayleighStage(getAltitude: () => number): {
  fragmentShader: string;
  uniforms: { altitude: () => number };
} {
  return {
    fragmentShader: rayleighShader,
    uniforms: { altitude: getAltitude },
  };
}
