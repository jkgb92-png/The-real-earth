/**
 * packages/shaders/src/rayleigh_atmosphere.glsl
 *
 * Rayleigh scattering atmospheric fragment shader for CesiumJS PostProcessStage.
 *
 * Simulates how sunlight scatters through the atmosphere at low altitudes,
 * producing the "Blue Marble" halo effect that makes the Earth look premium
 * from orbit.
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
    float scatter = exp(-altitude / 8500.0);

    // Dominant scattering wavelength — blue-shifted ambient sky colour.
    vec3 sky = vec3(0.18, 0.36, 0.72);

    // Blend the ground colour with atmospheric haze proportional to scatter.
    // The 0.4 factor keeps the land/sea colours visible from low orbit.
    color.rgb = mix(color.rgb, sky, scatter * 0.4);

    out_FragColor = color;
}
