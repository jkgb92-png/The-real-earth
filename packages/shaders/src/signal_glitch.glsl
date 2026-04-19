/**
 * packages/shaders/src/signal_glitch.glsl
 *
 * Fragment shader for the "Satellite Signal Interference" full-screen pass.
 *
 * Triggered for ≈ 200 ms on every Spec-Ops feature toggle by setting
 * `u_intensity = 1.0`.  The render loop decays u_intensity at 6×/s so the
 * glitch naturally fades without a separate timer.
 *
 * Effects (all scale with u_intensity)
 * ─────────────────────────────────────
 *  1. Horizontal scan-band shift   — coarse 30-band horizontal jitter
 *  2. Chromatic aberration         — R/B channel separation ±0.3 %
 *  3. Scanline darkening           — sine-wave darkening at 400 lines
 *  4. White noise grain            — hash-based additive grain
 *
 * Uniforms
 * ─────────
 *  tDiffuse     — input colour texture (provided by EffectComposer)
 *  u_intensity  — effect strength 0 (off) → 1 (full glitch)
 *  u_time       — elapsed seconds (drives temporal noise variation)
 */

uniform sampler2D tDiffuse;
uniform float     u_intensity;
uniform float     u_time;

varying vec2 vUv;

float hash(vec2 p) {
    p  = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

void main() {
    /* No-op when idle — saves shader cost entirely. */
    if (u_intensity < 0.01) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
    }

    /* ── Horizontal scan-line shift ───────────────────────────────────────── */
    float band      = floor(vUv.y * 30.0) / 30.0;
    float shift     = (hash(vec2(band, u_time * 8.0)) - 0.5) * 0.04 * u_intensity;
    vec2  shiftedUv = vec2(fract(vUv.x + shift), vUv.y);

    vec4  col = texture2D(tDiffuse, shiftedUv);

    /* ── Chromatic aberration ──────────────────────────────────────────────── */
    float ca = 0.003 * u_intensity;
    col.r    = texture2D(tDiffuse, shiftedUv + vec2( ca, 0.0)).r;
    col.b    = texture2D(tDiffuse, shiftedUv + vec2(-ca, 0.0)).b;

    /* ── CRT scanline darkening ────────────────────────────────────────────── */
    float scanline = 0.85 + 0.15 * sin(vUv.y * 400.0);
    col.rgb       *= scanline;

    /* ── White noise grain ────────────────────────────────────────────────── */
    float noise = (hash(vUv + u_time) - 0.5) * 0.12 * u_intensity;
    col.rgb    += noise;

    gl_FragColor = col;
}
