/**
 * packages/shaders/src/index.ts
 *
 * Exports GLSL shader source strings and CesiumJS / Three.js integration helpers.
 *
 * Shaders
 * -------
 *  rayleighShader        — CesiumJS PostProcessStage: enhanced Rayleigh atmosphere
 *  voxelVertShader       — Three.js ShaderMaterial vertex: subsurface voxel world pos
 *  voxelFragShader       — Three.js ShaderMaterial fragment: neon cyan↔purple glow
 *  roadPulseVertShader   — Three.js ShaderMaterial vertex: pass-through with UV
 *  roadPulseFragShader   — Three.js ShaderMaterial fragment: animated dash pulse
 *  scannerVertShader     — EffectComposer ShaderPass vertex: full-screen quad UV
 *  scannerFragShader     — EffectComposer ShaderPass fragment: Sobel + Solar-Gold ring
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

// ── Subsurface Voxel ─────────────────────────────────────────────────────────

/**
 * Vertex shader for the subsurface voxel layer.
 * Passes world-space position to the fragment shader so each voxel box
 * gets a unique animation phase based on its location.
 */
export const voxelVertShader = /* glsl */ `
varying vec3 vWorldPos;

void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos     = worldPos.xyz;
    gl_Position   = projectionMatrix * viewMatrix * worldPos;
}
`;

/**
 * Fragment shader for the subsurface voxel layer.
 * Neon cyan ↔ purple pulse driven by world position + elapsed time.
 * Matches packages/shaders/src/subsurface_voxel.glsl.
 */
export const voxelFragShader = /* glsl */ `
uniform float time;
uniform float scannerRadius;

varying vec3 vWorldPos;

void main() {
    float phase = vWorldPos.x * 0.02 + vWorldPos.z * 0.02;
    float cycle = sin(time * 1.5 + phase) * 0.5 + 0.5;

    vec3 cyan   = vec3(0.0,   1.0,   0.8);
    vec3 purple = vec3(0.482, 0.169, 1.0);
    vec3 base   = mix(cyan, purple, cycle);

    float pulse = 1.0 + 0.4 * sin(time * 3.14 + vWorldPos.y * 0.3);
    gl_FragColor = vec4(base * pulse, 0.85);
}
`;

// ── Road Pulse Flow ───────────────────────────────────────────────────────────

/**
 * Vertex shader shared by all road-pulse Line geometries.
 * UV.x encodes normalised arc-length (0 → 1) along each road segment.
 */
export const roadPulseVertShader = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/**
 * Fragment shader for the Live-Pulse road-flow animation.
 * Core expression: fract(vUv.x - time * flowRate * 0.3)
 * Matches packages/shaders/src/road_pulse.glsl.
 */
export const roadPulseFragShader = /* glsl */ `
uniform float time;
uniform float flowRate;
uniform float congestion;
uniform float scannerRadius;

varying vec2 vUv;

vec3 pulseColor(float c) {
    vec3 cyan  = vec3(0.0,  0.898, 1.0);
    vec3 amber = vec3(1.0,  0.769, 0.0);
    vec3 red   = vec3(1.0,  0.09,  0.267);
    if (c < 0.5) return mix(cyan, amber, c * 2.0);
    return mix(amber, red, (c - 0.5) * 2.0);
}

void main() {
    float p    = fract(vUv.x - time * flowRate * 0.3);
    float dash = smoothstep(0.0, 0.08, p) * smoothstep(0.55, 0.40, p);
    if (dash < 0.01) discard;
    vec3 col = pulseColor(congestion) * (1.0 + dash * 1.5);
    gl_FragColor = vec4(col, dash * 0.9);
}
`;

// ── Semantic Scanner ──────────────────────────────────────────────────────────

/**
 * Full-screen quad vertex shader for the EffectComposer ShaderPass.
 * Clip-space pass-through — no projection transform needed.
 */
export const scannerVertShader = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv         = uv;
    gl_Position = vec4(position, 1.0);
}
`;

/**
 * Fragment shader for the Semantic Scanner post-processing pass.
 * Sobel edge detection + expanding Solar-Gold ring.
 * Matches packages/shaders/src/semantic_pulse.glsl.
 */
export const scannerFragShader = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float     scannerRadius;
uniform vec2      resolution;
uniform float     u_active;

varying vec2 vUv;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float sobelEdge(vec2 uv) {
    vec2 t  = vec2(1.0) / resolution;
    float tl = luma(texture2D(tDiffuse, uv + t * vec2(-1.0, -1.0)).rgb);
    float tc = luma(texture2D(tDiffuse, uv + t * vec2( 0.0, -1.0)).rgb);
    float tr = luma(texture2D(tDiffuse, uv + t * vec2( 1.0, -1.0)).rgb);
    float ml = luma(texture2D(tDiffuse, uv + t * vec2(-1.0,  0.0)).rgb);
    float mr = luma(texture2D(tDiffuse, uv + t * vec2( 1.0,  0.0)).rgb);
    float bl = luma(texture2D(tDiffuse, uv + t * vec2(-1.0,  1.0)).rgb);
    float bc = luma(texture2D(tDiffuse, uv + t * vec2( 0.0,  1.0)).rgb);
    float br = luma(texture2D(tDiffuse, uv + t * vec2( 1.0,  1.0)).rgb);
    float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
    float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
    return sqrt(gx * gx + gy * gy);
}

void main() {
    vec4 src = texture2D(tDiffuse, vUv);
    if (u_active < 0.5) { gl_FragColor = src; return; }

    float dist     = length(vUv - 0.5) * 2.0;
    float ring     = smoothstep(0.05, 0.0, abs(dist - scannerRadius));
    float edge     = clamp(sobelEdge(vUv) * 5.0, 0.0, 1.0);
    vec3 solarGold = vec3(1.0, 0.843, 0.0);
    float blend    = clamp(ring * edge * 2.5, 0.0, 1.0);

    gl_FragColor = vec4(mix(src.rgb, solarGold, blend), src.a);
}
`;
