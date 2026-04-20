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
export declare const rayleighShader = "\nuniform sampler2D colorTexture;\n\n// Camera altitude in metres above the ellipsoid surface.\nuniform float altitude;\n\nin vec2 v_textureCoordinates;\n\nvoid main() {\n    vec4 color = texture(colorTexture, v_textureCoordinates);\n\n    // Rayleigh scale height ~8500 m \u2014 scattering diminishes exponentially.\n    // Guard against altitude \u2264 0 (camera below ellipsoid at init or deep zoom)\n    // which would make exp() return > 1 and extrapolate colors out of range.\n    float scatter = exp(-max(altitude, 0.0) / 8500.0);\n\n    // Primary blue-sky scatter colour.\n    vec3 blueScatter = vec3(0.18, 0.36, 0.72);\n\n    // Limb brightening: amplify atmosphere near the screen horizon.\n    vec2 uv = v_textureCoordinates * 2.0 - 1.0;\n    float r2 = dot(uv, uv);\n    float limb = smoothstep(0.5, 1.0, r2) * 0.5;\n\n    // Chromatic sunset: blend warm reddish-orange at low altitudes along\n    // horizontal bands (approximates terminator zone sunrise/sunset colours).\n    float sunsetFactor = scatter * (1.0 - abs(uv.y)) * 0.6;\n    vec3 sunsetColor = vec3(0.85, 0.45, 0.12);\n\n    // Combine: scatter, limb halo, and sunset dispersion.\n    vec3 atmo = mix(blueScatter, sunsetColor, clamp(sunsetFactor * 0.4, 0.0, 0.5));\n    color.rgb = mix(color.rgb, atmo, scatter * 0.38 + limb * 0.25);\n\n    out_FragColor = color;\n}\n";
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
export declare function createRayleighStage(getAltitude: () => number): {
    fragmentShader: string;
    uniforms: {
        altitude: () => number;
    };
};
/**
 * Vertex shader for the subsurface voxel layer.
 * Passes world-space position to the fragment shader so each voxel box
 * gets a unique animation phase based on its location.
 */
export declare const voxelVertShader = "\nvarying vec3 vWorldPos;\n\nvoid main() {\n    vec4 worldPos = modelMatrix * vec4(position, 1.0);\n    vWorldPos     = worldPos.xyz;\n    gl_Position   = projectionMatrix * viewMatrix * worldPos;\n}\n";
/**
 * Fragment shader for the subsurface voxel layer.
 * Neon cyan ↔ purple pulse driven by world position + elapsed time.
 * Matches packages/shaders/src/subsurface_voxel.glsl.
 */
export declare const voxelFragShader = "\nuniform float time;\nuniform float scannerRadius;\n\nvarying vec3 vWorldPos;\n\nvoid main() {\n    float phase = vWorldPos.x * 0.02 + vWorldPos.z * 0.02;\n    float cycle = sin(time * 1.5 + phase) * 0.5 + 0.5;\n\n    vec3 cyan   = vec3(0.0,   1.0,   0.8);\n    vec3 purple = vec3(0.482, 0.169, 1.0);\n    vec3 base   = mix(cyan, purple, cycle);\n\n    float pulse = 1.0 + 0.4 * sin(time * 3.14 + vWorldPos.y * 0.3);\n    gl_FragColor = vec4(base * pulse, 0.85);\n}\n";
/**
 * Vertex shader shared by all road-pulse Line geometries.
 * UV.x encodes normalised arc-length (0 → 1) along each road segment.
 */
export declare const roadPulseVertShader = "\nvarying vec2 vUv;\nvoid main() {\n    vUv         = uv;\n    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}\n";
/**
 * Fragment shader for the Live-Pulse road-flow animation.
 * Core expression: fract(vUv.x - time * flowRate * 0.3)
 * Includes uBurstTime for the neon-gold data-burst packet (emissive 5.0).
 * Matches packages/shaders/src/road_pulse.glsl.
 */
export declare const roadPulseFragShader = "\nuniform float time;\nuniform float flowRate;\nuniform float congestion;\nuniform float scannerRadius;\nuniform float uBurstTime;\n\nvarying vec2 vUv;\n\nvec3 pulseColor(float c) {\n    vec3 cyan  = vec3(0.0,  0.898, 1.0);\n    vec3 amber = vec3(1.0,  0.769, 0.0);\n    vec3 red   = vec3(1.0,  0.09,  0.267);\n    if (c < 0.5) return mix(cyan, amber, c * 2.0);\n    return mix(amber, red, (c - 0.5) * 2.0);\n}\n\nvoid main() {\n    float p    = fract(vUv.x - time * flowRate * 0.3);\n    float dash = smoothstep(0.0, 0.08, p) * smoothstep(0.55, 0.40, p);\n\n    vec3  col   = pulseColor(congestion) * (1.0 + dash * 1.5);\n    float alpha = dash * 0.9;\n\n    float burstActive = step(0.0, uBurstTime) * step(uBurstTime, 1.0);\n    float bDist = vUv.x - uBurstTime;\n    float tail  = burstActive * smoothstep(-0.1, 0.0, bDist) * smoothstep(0.01, 0.0, bDist);\n    float head  = burstActive * smoothstep(0.01, 0.0, abs(bDist));\n    float burst = clamp(tail + head * 2.0, 0.0, 1.0);\n    vec3  gold  = vec3(1.0, 0.84, 0.0);\n\n    col   = mix(col, gold * 5.0, burst);\n    alpha = max(alpha, burst * 0.95);\n\n    if (alpha < 0.01) discard;\n    gl_FragColor = vec4(col, alpha);\n}\n";
/**
 * Full-screen quad vertex shader for the EffectComposer ShaderPass.
 * Clip-space pass-through — no projection transform needed.
 */
export declare const scannerVertShader = "\nvarying vec2 vUv;\nvoid main() {\n    vUv         = uv;\n    gl_Position = vec4(position, 1.0);\n}\n";
/**
 * Fragment shader for the Semantic Scanner post-processing pass.
 * Sobel edge detection + expanding Solar-Gold ring.
 * Matches packages/shaders/src/semantic_pulse.glsl.
 */
export declare const scannerFragShader = "\nuniform sampler2D tDiffuse;\nuniform float     scannerRadius;\nuniform vec2      resolution;\nuniform float     u_active;\n\nvarying vec2 vUv;\n\nfloat luma(vec3 c) {\n    return dot(c, vec3(0.2126, 0.7152, 0.0722));\n}\n\nfloat sobelEdge(vec2 uv) {\n    vec2 t  = vec2(1.0) / resolution;\n    float tl = luma(texture2D(tDiffuse, uv + t * vec2(-1.0, -1.0)).rgb);\n    float tc = luma(texture2D(tDiffuse, uv + t * vec2( 0.0, -1.0)).rgb);\n    float tr = luma(texture2D(tDiffuse, uv + t * vec2( 1.0, -1.0)).rgb);\n    float ml = luma(texture2D(tDiffuse, uv + t * vec2(-1.0,  0.0)).rgb);\n    float mr = luma(texture2D(tDiffuse, uv + t * vec2( 1.0,  0.0)).rgb);\n    float bl = luma(texture2D(tDiffuse, uv + t * vec2(-1.0,  1.0)).rgb);\n    float bc = luma(texture2D(tDiffuse, uv + t * vec2( 0.0,  1.0)).rgb);\n    float br = luma(texture2D(tDiffuse, uv + t * vec2( 1.0,  1.0)).rgb);\n    float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;\n    float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;\n    return sqrt(gx * gx + gy * gy);\n}\n\nvoid main() {\n    vec4 src = texture2D(tDiffuse, vUv);\n    if (u_active < 0.5) { gl_FragColor = src; return; }\n\n    float dist     = length(vUv - 0.5) * 2.0;\n    float ring     = smoothstep(0.05, 0.0, abs(dist - scannerRadius));\n    float edge     = clamp(sobelEdge(vUv) * 5.0, 0.0, 1.0);\n    vec3 solarGold = vec3(1.0, 0.843, 0.0);\n    float blend    = clamp(ring * edge * 2.5, 0.0, 1.0);\n\n    gl_FragColor = vec4(mix(src.rgb, solarGold, blend), src.a);\n}\n";
/**
 * Vertex shader for placeholder building meshes.
 * Passes world-space XZ so the scanner ring can be applied in fragment.
 * Encodes a per-building pseudo-random "occupancy" from the model matrix.
 */
export declare const buildingVertShader = "\nuniform float scannerRadius;\nvarying vec3  vWorldPos;\nvarying float vOccupancy;\nfloat rand(float n) { return fract(sin(n * 127.1) * 43758.5453); }\nvoid main() {\n    vec4 wp    = modelMatrix * vec4(position, 1.0);\n    vWorldPos  = wp.xyz;\n    /* 0.01 / 0.007: scale world-unit translation components so adjacent buildings\n       map to distinct positions in hash-space. Incommensurable factors prevent\n       column/row aliasing in the pseudo-random output. */\n    vOccupancy = rand(modelMatrix[3][0] * 0.01 + modelMatrix[3][2] * 0.007);\n    gl_Position = projectionMatrix * viewMatrix * wp;\n}\n";
/**
 * Fragment shader for the ghost-building heatmap.
 * When the scanner ring passes over a building it pulses from cool blue to
 * hot red depending on the pseudo-random "occupancy" of that building.
 * A sub-pixel dither offset on worldDist eliminates z-fighting where building
 * walls meet the ground plane.
 */
export declare const buildingFragShader = "\nuniform float scannerRadius;\nuniform float u_scannerActive;\nvarying vec3  vWorldPos;\nvarying float vOccupancy;\n\n/* Low-quality hash used for sub-pixel dither \u2014 breaks up z-fighting bands. */\nfloat dither(vec2 p) {\n    p  = fract(p * vec2(234.34, 435.345));\n    p += dot(p, p + 34.23);\n    return fract(p.x * p.y);\n}\n\nvec3 heatColor(float t) {\n    vec3 blue  = vec3(0.0, 0.33, 1.0);\n    vec3 cyan  = vec3(0.0, 0.9,  1.0);\n    vec3 amber = vec3(1.0, 0.75, 0.0);\n    vec3 red   = vec3(1.0, 0.13, 0.0);\n    if (t < 0.33) return mix(blue,  cyan,  t / 0.33);\n    if (t < 0.66) return mix(cyan,  amber, (t - 0.33) / 0.33);\n    return             mix(amber, red,   (t - 0.66) / 0.34);\n}\n\nvoid main() {\n    vec3 base = vec3(0.16, 0.28, 0.47);\n    if (u_scannerActive < 0.5) { gl_FragColor = vec4(base, 1.0); return; }\n    /* \u00B10.001 dither offset on worldDist prevents co-planar z-fighting bands\n       between building walls and the ground plane. */\n    float jitter    = (dither(vWorldPos.xz) - 0.5) * 0.001;\n    float worldDist = length(vWorldPos.xz) / 500.0 + jitter;\n    float ring      = smoothstep(0.08, 0.0, abs(worldDist - scannerRadius));\n    vec3  heat      = heatColor(vOccupancy);\n    gl_FragColor    = vec4(mix(base, heat * 2.0, ring * 0.85), 1.0);\n}\n";
/**
 * Fragment shader for the CRT-static / horizontal-shift glitch pass.
 * Triggered for ~200 ms whenever a Spec-Ops feature is toggled on/off.
 * u_intensity decays from 1.0 → 0 at 6×/s in the render loop.
 */
export declare const glitchFragShader = "\nuniform sampler2D tDiffuse;\nuniform float     u_intensity;\nuniform float     u_time;\nvarying vec2 vUv;\n\nfloat hash(vec2 p) {\n    p = fract(p * vec2(234.34, 435.345));\n    p += dot(p, p + 34.23);\n    return fract(p.x * p.y);\n}\n\nvoid main() {\n    if (u_intensity < 0.01) { gl_FragColor = texture2D(tDiffuse, vUv); return; }\n    float band      = floor(vUv.y * 30.0) / 30.0;\n    float shift     = (hash(vec2(band, u_time * 8.0)) - 0.5) * 0.04 * u_intensity;\n    vec2  shiftedUv = vec2(fract(vUv.x + shift), vUv.y);\n    vec4  col       = texture2D(tDiffuse, shiftedUv);\n    float ca        = 0.003 * u_intensity;\n    col.r           = texture2D(tDiffuse, shiftedUv + vec2( ca, 0.0)).r;\n    col.b           = texture2D(tDiffuse, shiftedUv + vec2(-ca, 0.0)).b;\n    float scanline  = 0.85 + 0.15 * sin(vUv.y * 400.0);\n    col.rgb        *= scanline;\n    float noise     = (hash(vUv + u_time) - 0.5) * 0.12 * u_intensity;\n    col.rgb        += noise;\n    gl_FragColor    = col;\n}\n";
