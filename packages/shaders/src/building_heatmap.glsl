/**
 * packages/shaders/src/building_heatmap.glsl
 *
 * Fragment shader for the "Ghost-Building" heatmap.
 * Applied to placeholder building meshes in the Spec-Ops Three.js overlay.
 *
 * When the semantic scanner ring sweeps over a building the fragment colour
 * transitions from a cool steel-blue base to a heat gradient driven by a
 * pseudo-random "occupancy" value baked per-building in the vertex shader.
 *
 * Heat gradient (occupancy 0 → 1)
 * ─────────────────────────────────
 *   0.00  — cool blue  (#0055ff)
 *   0.33  — cyan       (#00e5ff)
 *   0.66  — amber      (#ffc000)
 *   1.00  — hot red    (#ff2200)
 *
 * Uniforms
 * ─────────
 *  scannerRadius   — normalised ring radius (0 → 1), matches scannerPass
 *  u_scannerActive — 0.0 = idle, 1.0 = scanner running
 *
 * Varyings
 * ─────────
 *  vWorldPos   — world-space position (from BUILDING_VERT)
 *  vOccupancy  — pseudo-random 0–1 value baked per building
 */

uniform float scannerRadius;
uniform float u_scannerActive;
varying vec3  vWorldPos;
varying float vOccupancy;

vec3 heatColor(float t) {
    vec3 blue  = vec3(0.0,  0.33, 1.0);
    vec3 cyan  = vec3(0.0,  0.9,  1.0);
    vec3 amber = vec3(1.0,  0.75, 0.0);
    vec3 red   = vec3(1.0,  0.13, 0.0);

    if (t < 0.33) return mix(blue,  cyan,  t / 0.33);
    if (t < 0.66) return mix(cyan,  amber, (t - 0.33) / 0.33);
    return             mix(amber, red,   (t - 0.66) / 0.34);
}

void main() {
    /* Base building colour — steel blue. */
    vec3 base = vec3(0.16, 0.28, 0.47);

    if (u_scannerActive < 0.5) {
        gl_FragColor = vec4(base, 1.0);
        return;
    }

    /* Approximate screen-space ring using world XZ distance from scene centre.
       500 m is chosen to match the ~500 m radius of the placeholder city block. */
    float worldDist = length(vWorldPos.xz) / 500.0;
    float ring      = smoothstep(0.08, 0.0, abs(worldDist - scannerRadius));

    vec3  heat  = heatColor(vOccupancy);
    /* Multiply heat by 2 for an over-bright, emissive look. */
    gl_FragColor = vec4(mix(base, heat * 2.0, ring * 0.85), 1.0);
}
