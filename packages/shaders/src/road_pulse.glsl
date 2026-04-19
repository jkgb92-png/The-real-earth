/**
 * packages/shaders/src/road_pulse.glsl
 *
 * Fragment shader for the Live-Pulse road-flow animation.
 * Applied to THREE.Line geometry whose UV.x coordinate encodes normalised
 * arc-length along the road (0 at start → 1 at end).
 *
 * Animation
 * ---------
 * The core expression `fract(vUv.x - time * flowRate * 0.3)` creates a dash
 * pattern that travels from road-start to road-end at a rate controlled by
 * `flowRate` from the mock data stream.  A smoothstep window shapes each
 * dash into a soft pulse blob rather than a hard square wave.
 *
 * Color
 * -----
 * `congestion` (0 → 1) interpolates through a three-stop gradient:
 *   0 = cyan  (#00e5ff) — free-flow traffic / full energy throughput
 *   0.5 = amber (#ffc400) — moderate congestion
 *   1 = red   (#ff1744) — gridlock / critical load
 *
 * Uniforms
 * --------
 *  time          — elapsed seconds
 *  flowRate      — dash travel speed (0–1, driven by MockDataStream)
 *  congestion    — colour gradient position (0–1, driven by MockDataStream)
 *  scannerRadius — reserved; exposes the scanner ring state to road materials
 */

uniform float time;
uniform float flowRate;
uniform float congestion;
uniform float scannerRadius;

varying vec2 vUv;

vec3 pulseColor(float c) {
    vec3 cyan  = vec3(0.0,  0.898, 1.0);   /* #00e5ff */
    vec3 amber = vec3(1.0,  0.769, 0.0);   /* #ffc400 */
    vec3 red   = vec3(1.0,  0.09,  0.267); /* #ff1744 */

    if (c < 0.5) return mix(cyan, amber, c * 2.0);
    return mix(amber, red, (c - 0.5) * 2.0);
}

void main() {
    /* Travelling dash: position along road minus animated time offset. */
    float p    = fract(vUv.x - time * flowRate * 0.3);

    /* Smooth on/off window — 50 % duty cycle with soft edges. */
    float dash = smoothstep(0.0, 0.08, p) * smoothstep(0.55, 0.40, p);

    /* Discard fully transparent fragments (reduces fill-rate cost). */
    if (dash < 0.01) discard;

    vec3 col = pulseColor(congestion) * (1.0 + dash * 1.5);
    gl_FragColor = vec4(col, dash * 0.9);
}
