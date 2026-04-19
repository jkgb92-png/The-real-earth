/**
 * packages/shaders/src/semantic_pulse.glsl
 *
 * Post-processing fragment shader for the Semantic Scanner effect.
 * Composited as a full-screen ShaderPass via THREE.EffectComposer.
 *
 * Algorithm
 * ---------
 * 1. A ring of radius `scannerRadius` (0 → 1, mapped to screen diagonal)
 *    expands from the screen centre outward.
 * 2. At each fragment touched by the ring, a 3×3 Sobel kernel computes the
 *    luminance gradient.  Strong gradients (building edges, roof lines) get
 *    highlighted in Solar-Gold (#FFD700).
 * 3. When `u_active` is 0 the pass is a no-op, adding zero cost to the
 *    render pipeline when the scanner is idle.
 *
 * Uniforms
 * --------
 *  tDiffuse      — input colour texture (provided automatically by EffectComposer)
 *  scannerRadius — expanding ring position [0, 1]
 *  resolution    — viewport size in physical pixels (vec2)
 *  u_active      — 1.0 when scanner is running, 0.0 otherwise
 */

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

    /* No-op fast-path when scanner is idle. */
    if (u_active < 0.5) {
        gl_FragColor = src;
        return;
    }

    /* Radial distance from screen centre, mapped 0 (centre) → 1 (corner). */
    float dist = length(vUv - 0.5) * 2.0;

    /* Thin ring centred on the expanding scannerRadius. */
    float ring = smoothstep(0.05, 0.0, abs(dist - scannerRadius));

    /* Sobel edge strength — highlights structural outlines. */
    float edge = clamp(sobelEdge(vUv) * 5.0, 0.0, 1.0);

    /* Solar-Gold (#FFD700) tint proportional to edge strength × ring. */
    vec3 solarGold = vec3(1.0, 0.843, 0.0);
    float blend    = clamp(ring * edge * 2.5, 0.0, 1.0);

    gl_FragColor = vec4(mix(src.rgb, solarGold, blend), src.a);
}
