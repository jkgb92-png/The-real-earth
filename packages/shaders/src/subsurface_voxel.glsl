/**
 * packages/shaders/src/subsurface_voxel.glsl
 *
 * Fragment shader for the subsurface voxel layer (utility lines / groundwater).
 * Each voxel pulses between cyan (#00ffcc) and purple (#7b2aff) driven by
 * world-space position and a time uniform, producing a differentiated neon
 * glow per voxel without per-instance CPU updates.
 *
 * Uniforms
 * --------
 *  time          — elapsed seconds (from THREE.Clock)
 *  scannerRadius — 0–1 scanner ring position; reserved for future per-material
 *                  highlighting when the scanner wave passes over a voxel
 *
 * Varyings
 * --------
 *  vWorldPos — fragment position in world space (set by companion vertex shader)
 */

uniform float time;
uniform float scannerRadius;

varying vec3 vWorldPos;

void main() {
    /* Phase offset derived from world position gives each voxel a unique cycle. */
    float phase = vWorldPos.x * 0.02 + vWorldPos.z * 0.02;
    float cycle = sin(time * 1.5 + phase) * 0.5 + 0.5;

    vec3 cyan   = vec3(0.0,   1.0,   0.8);    /* #00ffcc */
    vec3 purple = vec3(0.482, 0.169, 1.0);    /* #7b2aff */
    vec3 base   = mix(cyan, purple, cycle);

    /* Secondary flicker driven by Y position gives depth variation. */
    float pulse = 1.0 + 0.4 * sin(time * 3.14 + vWorldPos.y * 0.3);

    gl_FragColor = vec4(base * pulse, 0.85);
}
