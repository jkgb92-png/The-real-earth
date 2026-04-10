/**
 * packages/shaders/src/rayleigh_atmosphere.glsl
 *
 * Enhanced Rayleigh scattering atmospheric fragment shader for CesiumJS PostProcessStage.
 *
 * Simulates how sunlight scatters through the atmosphere at low altitudes,
 * producing:
 *  - The "Blue Marble" atmospheric haze from orbit
 *  - Limb brightening: an iconic bright-blue halo at the planet horizon
 *  - Chromatic sunset dispersion: warm reddish-orange tones at low altitudes
 *    along sunrise/sunset terminator zones
 *
 * Usage (CesiumJS):
 *   import { rayleighShader } from '@the-real-earth/shaders';
 *
 *   viewer.postProcessStages.add(
 *     new Cesium.PostProcessStage({
 *       fragmentShader: rayleighShader,
 *       uniforms: {
 *         altitude: () => viewer.camera.positionCartographic.height,
 *       },
 *     })
 *   );
 */

// Language: GLSL ES 3.00
uniform sampler2D colorTexture;

// Camera altitude in metres above the ellipsoid surface.
uniform float altitude;

in vec2 v_textureCoordinates;

void main() {
    vec4 color = texture(colorTexture, v_textureCoordinates);

    // Rayleigh scale height ≈ 8 500 m — scattering diminishes exponentially
    // with altitude.  At sea level scatter ≈ 1.0; at 100 km it is ~0.0.
    // Guard against altitude ≤ 0 (camera below ellipsoid at init or deep zoom)
    // which would make exp() return > 1 and extrapolate colors out of range.
    float scatter = exp(-max(altitude, 0.0) / 8500.0);

    // Primary blue-sky scatter colour.
    vec3 blueScatter = vec3(0.18, 0.36, 0.72);

    // ── Limb brightening ─────────────────────────────────────────────────────
    // Pixels near the screen edge correspond to the planet's limb (horizon).
    // Real atmospheres brighten there because light travels a longer path.
    vec2 uv = v_textureCoordinates * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    float limb = smoothstep(0.5, 1.0, r2) * 0.5;

    // ── Chromatic sunset dispersion ──────────────────────────────────────────
    // At low altitudes the sun near the horizon scatters shorter wavelengths
    // away, leaving the warm reddish-orange glow of sunrise/sunset.
    float sunsetFactor = scatter * (1.0 - abs(uv.y)) * 0.6;
    vec3 sunsetColor = vec3(0.85, 0.45, 0.12);

    // Blend primary atmosphere toward sunset colour proportionally.
    vec3 atmo = mix(blueScatter, sunsetColor, clamp(sunsetFactor * 0.4, 0.0, 0.5));

    // Apply: ground colour + atmospheric haze (scatter) + limb halo (limb).
    color.rgb = mix(color.rgb, atmo, scatter * 0.38 + limb * 0.25);

    out_FragColor = color;
}
