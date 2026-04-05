/**
 * packages/shaders/src/index.ts
 *
 * Exports GLSL shader source strings and CesiumJS integration helpers.
 */

// Inline the GLSL at build time so consumers don't need a file-loader.
export const rayleighShader = /* glsl */ `
uniform sampler2D colorTexture;
uniform float altitude;
in vec2 v_textureCoordinates;

void main() {
    vec4 color = texture(colorTexture, v_textureCoordinates);
    float scatter = exp(-altitude / 8500.0);
    vec3 sky = vec3(0.18, 0.36, 0.72);
    color.rgb = mix(color.rgb, sky, scatter * 0.4);
    out_FragColor = color;
}
`;

/**
 * Creates a CesiumJS PostProcessStage configuration object for Rayleigh
 * atmospheric scattering.
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
