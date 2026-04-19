/**
 * packages/shaders/src/road_pulse.glsl
 *
 * Fragment shader for the Live-Pulse road-flow animation.
 * Applied to THREE.Line geometry whose UV.x coordinate encodes normalised
 * arc-length along the road (0 at start → 1 at end).
 *
 * Standard dash animation
 * -----------------------
 * The core expression `fract(vUv.x - time * flowRate * 0.3)` creates a dash
 * pattern that travels from road-start to road-end.
 *
 * Data-burst overlay  (uBurstTime)
 * ---------------------------------
 * When `uBurstTime` is in [0, 1] a neon-gold data packet travels along the
 * segment.  The packet has:
 *   • A 0.1-length comet tail (smoothstep ramp)
 *   • A sharp head cap with emissive intensity 5.0  → creates bloom appearance
 * A value outside [0, 1] means no active burst on this segment.
 *
 * Uniforms
 * --------
 *  time          — elapsed seconds
 *  flowRate      — dash travel speed (0–1, driven by MockDataStream)
 *  congestion    — colour gradient position (0–1, driven by MockDataStream)
 *  scannerRadius — reserved for future per-material scanner highlight
 *  uBurstTime    — normalised burst packet position (0–1) or −1 for none
 */

uniform float time;
uniform float flowRate;
uniform float congestion;
uniform float scannerRadius;
uniform float uBurstTime;

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

    vec3  col   = pulseColor(congestion) * (1.0 + dash * 1.5);
    float alpha = dash * 0.9;

    float burstActive = step(0.0, uBurstTime) * step(uBurstTime, 1.0);
    float bDist = vUv.x - uBurstTime;
    float tail  = burstActive * smoothstep(-0.1, 0.0, bDist) * smoothstep(0.01, 0.0, bDist);
    float head  = burstActive * smoothstep(0.01, 0.0, abs(bDist));
    float burst = clamp(tail + head * 2.0, 0.0, 1.0);
    vec3  gold  = vec3(1.0, 0.84, 0.0);

    col   = mix(col, gold * 5.0, burst);
    alpha = max(alpha, burst * 0.95);

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
}
