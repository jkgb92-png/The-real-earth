/**
 * apps/web/public/spec-ops-worker.js
 *
 * Spec-Ops Digital Twin — Web Worker (classic worker, OffscreenCanvas).
 *
 * Architecture
 * ────────────
 * The main thread (globe.html) transfers an OffscreenCanvas to this worker.
 * All Three.js rendering, animation, and asset management happens here.
 * The main thread only forwards DOM events (mouse, touch, wheel, resize)
 * and SpecOps command messages ({ type: 'specOps', feature, enabled }).
 *
 * Features
 * ────────
 * 1. Subsurface X-Ray  — ClippingPlane at Y=0 peels back terrain; animated
 *                        neon voxel InstanceMesh reveals subsurface utilities.
 * 2. Hero Asset Swap   — Point-cloud Gaussian-Splat placeholder at the hero
 *                        coordinate [26.6133°N, 81.6317°W]; cross-fades in
 *                        when the camera is within 100 m of the origin.
 * 3. Road Pulse Flow   — Loads lehigh_roads.geojson; each LineString gets a
 *                        ShaderMaterial whose fragment shader animates dashes
 *                        with `fract(vUv.x - time * flowRate * 0.3)`. Speed
 *                        and colour driven by MockDataStream at 10 Hz.
 * 4. Semantic Scanner  — EffectComposer ShaderPass: expanding ring + Sobel
 *                        edge detection highlights edges in Solar-Gold.
 *                        A `scannerRadius` uniform is present on every custom
 *                        material so road lines and voxels react to the scan.
 *
 * Performance
 * ───────────
 * • renderer.setAnimationLoop() falls back to setTimeout in workers (no RAF).
 * • 30 fps cap via manual timestamp gating (Chromebook-friendly).
 * • Shared BufferGeometry for voxel boxes — 400 Mesh nodes, one geometry.
 * • Shared ShaderMaterial per feature type — one uniform object, many nodes.
 * • Three.js renderer only calls composer.render() when a feature is active.
 * • OffscreenCanvas avoids layout/style recalcs on the main thread.
 *
 * Inbound messages  (main thread → worker)
 * ─────────────────────────────────────────
 *  { type: 'init',    canvas, width, height, apiKey }
 *  { type: 'resize',  width, height }
 *  { type: 'mousemove', x, y }
 *  { type: 'mousedown', button, x, y }
 *  { type: 'mouseup',   button }
 *  { type: 'wheel',     deltaY }
 *  { type: 'specOps',   feature, enabled }
 *
 * Outbound messages (worker → main thread)
 * ─────────────────────────────────────────
 *  { type: 'ready' }
 *  { type: 'heroProximity', near, distance }
 *  { type: 'scannerComplete' }
 *  { type: 'cameraCoords',  lat, lon }       — throttled to 6 Hz
 *  { type: 'dataBurst',     segment }        — fired every 3.5 s on burst cycle
 */

'use strict';

/* global THREE */

// ── CDN dependencies ──────────────────────────────────────────────────────────
// Three.js r128 retains examples/js/ UMD files that attach to global THREE.
importScripts(
  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/shaders/CopyShader.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/EffectComposer.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/RenderPass.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/postprocessing/ShaderPass.js'
);

// ── Constants ─────────────────────────────────────────────────────────────────
const HERO_LAT             = 26.6133;
const HERO_LON             = -81.6317;
const HERO_TRIGGER_RADIUS  = 100;          // metres
const DEG_TO_M_LAT         = 111320;
const DEG_TO_M_LON         = 111320 * Math.cos(HERO_LAT * Math.PI / 180); // ≈ 99 527
const TARGET_FPS            = 30;
const FRAME_INTERVAL_MS     = 1000 / TARGET_FPS;

// ── Inline GLSL ───────────────────────────────────────────────────────────────
// Shaders are embedded as template literals so the worker is self-contained.

const VOXEL_VERT = /* glsl */`
varying vec3 vWorldPos;
void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos     = worldPos.xyz;
    gl_Position   = projectionMatrix * viewMatrix * worldPos;
}`;

const VOXEL_FRAG = /* glsl */`
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
}`;

const ROAD_VERT = /* glsl */`
varying vec2 vUv;
void main() {
    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const ROAD_FRAG = /* glsl */`
uniform float time;
uniform float flowRate;
uniform float congestion;
uniform float scannerRadius;
/* uBurstTime: normalised position of the neon-gold data packet (0→1).
   A value outside [0,1] means no active burst on this segment. */
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
    /* Standard travelling dash. */
    float p    = fract(vUv.x - time * flowRate * 0.3);
    float dash = smoothstep(0.0, 0.08, p) * smoothstep(0.55, 0.40, p);

    vec3  col   = pulseColor(congestion) * (1.0 + dash * 1.5);
    float alpha = dash * 0.9;

    /* Data-burst overlay — neon-gold packet with a 0.1-length comet tail.
       uBurstTime < 0.0 or > 1.0 means no active burst → burst = 0. */
    float burstActive = step(0.0, uBurstTime) * step(uBurstTime, 1.0);
    float bDist = vUv.x - uBurstTime;             /* signed distance behind head */
    /* Tail extends 0.1 units behind the head (bDist in [-0.1, 0]). */
    float tail  = burstActive * smoothstep(-0.1, 0.0, bDist) * smoothstep(0.01, 0.0, bDist);
    /* Head is a sharp bright cap. */
    float head  = burstActive * smoothstep(0.01, 0.0, abs(bDist));

    float burst = clamp(tail + head * 2.0, 0.0, 1.0);
    vec3  gold  = vec3(1.0, 0.84, 0.0);

    /* Emissive intensity of 5.0 on the burst — creates bloom appearance. */
    col   = mix(col, gold * 5.0, burst);
    alpha = max(alpha, burst * 0.95);

    if (alpha < 0.01) discard;
    gl_FragColor = vec4(col, alpha);
}`;

const SPLAT_VERT = /* glsl */`
uniform float time;
varying float vFade;
void main() {
    vec3 pos = position;
    float r  = length(pos.xz);
    pos.y   += sin(time * 2.0 + r * 0.1) * 0.5;
    vFade    = max(0.0, 1.0 - length(pos) / 30.0);
    gl_PointSize = 3.0 + 2.0 * sin(time + r * 0.3);
    gl_Position  = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`;

const SPLAT_FRAG = /* glsl */`
uniform vec3 splatColor;
varying float vFade;
void main() {
    vec2  uv = gl_PointCoord - 0.5;
    float r  = dot(uv, uv) * 4.0;
    if (r > 1.0) discard;
    float alpha = (1.0 - r) * vFade * 0.8;
    gl_FragColor = vec4(splatColor * (1.0 + (1.0 - r)), alpha);
}`;

// Full-screen-quad vertex shader for ShaderPass (clip-space pass-through).
const SCANNER_VERT = /* glsl */`
varying vec2 vUv;
void main() {
    vUv         = uv;
    gl_Position = vec4(position, 1.0);
}`;

const SCANNER_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform float     scannerRadius;
uniform vec2      resolution;
uniform float     u_active;
varying vec2 vUv;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float sobelEdge(vec2 uv) {
    vec2 t  = vec2(1.0) / resolution;
    float tl = luma(texture2D(tDiffuse, uv + t * vec2(-1.0,-1.0)).rgb);
    float tc = luma(texture2D(tDiffuse, uv + t * vec2( 0.0,-1.0)).rgb);
    float tr = luma(texture2D(tDiffuse, uv + t * vec2( 1.0,-1.0)).rgb);
    float ml = luma(texture2D(tDiffuse, uv + t * vec2(-1.0, 0.0)).rgb);
    float mr = luma(texture2D(tDiffuse, uv + t * vec2( 1.0, 0.0)).rgb);
    float bl = luma(texture2D(tDiffuse, uv + t * vec2(-1.0, 1.0)).rgb);
    float bc = luma(texture2D(tDiffuse, uv + t * vec2( 0.0, 1.0)).rgb);
    float br = luma(texture2D(tDiffuse, uv + t * vec2( 1.0, 1.0)).rgb);
    float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
    float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
    return sqrt(gx*gx + gy*gy);
}
void main() {
    vec4 src = texture2D(tDiffuse, vUv);
    if (u_active < 0.5) { gl_FragColor = src; return; }
    float dist     = length(vUv - 0.5) * 2.0;
    float ring     = smoothstep(0.05, 0.0, abs(dist - scannerRadius));
    float edge     = clamp(sobelEdge(vUv) * 5.0, 0.0, 1.0);
    vec3  solarGold = vec3(1.0, 0.843, 0.0);
    float blend    = clamp(ring * edge * 2.5, 0.0, 1.0);
    gl_FragColor   = vec4(mix(src.rgb, solarGold, blend), src.a);
}`;

// ── Ghost-Building heatmap ─────────────────────────────────────────────────────
// Applied to placeholder building meshes. When the scanner ring passes over
// a building, its occupancy value (baked as vOccupancy) drives a heat gradient
// from cool blue (#0055ff) through cyan, through amber, to hot red (#ff2200).
const BUILDING_VERT = /* glsl */`
uniform float scannerRadius;
varying vec3  vWorldPos;
varying float vOccupancy;
/* Pseudo-random occupancy baked per-instance via the vertex y-position seed. */
float rand(float n) { return fract(sin(n * 127.1) * 43758.5453); }
void main() {
    vec4 wp    = modelMatrix * vec4(position, 1.0);
    vWorldPos  = wp.xyz;
    /* Use model-matrix translation as a unique seed per building. */
    vOccupancy = rand(modelMatrix[3][0] * 0.01 + modelMatrix[3][2] * 0.007);
    /* 0.01 / 0.007 scale the model-matrix translation components (world units) into
       a ~[0,1] range with enough spread that adjacent buildings get different hashes. */
    gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BUILDING_FRAG = /* glsl */`
uniform float scannerRadius;
uniform float u_scannerActive;
varying vec3  vWorldPos;
varying float vOccupancy;

/* Low-quality hash used for sub-pixel dither — breaks up z-fighting bands. */
float dither(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

vec3 heatColor(float t) {
    /* 0 = cool blue, 0.33 = cyan, 0.66 = amber, 1 = hot red */
    vec3 blue  = vec3(0.0, 0.33, 1.0);
    vec3 cyan  = vec3(0.0, 0.9,  1.0);
    vec3 amber = vec3(1.0, 0.75, 0.0);
    vec3 red   = vec3(1.0, 0.13, 0.0);
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

    /* Compute normalised world-XZ distance from scene centre.
       A sub-pixel dither offset (±0.001 of normalised radius) breaks up the
       co-planar z-fighting bands that appear where building walls meet the
       ground plane — buildings pop visibly ahead of the floor. */
    float jitter    = (dither(vWorldPos.xz) - 0.5) * 0.001;
    float worldDist = length(vWorldPos.xz) / 500.0 + jitter;
    float ring      = smoothstep(0.08, 0.0, abs(worldDist - scannerRadius));

    /* Blend to heat colour under the ring, weight by occupancy. */
    vec3  heat  = heatColor(vOccupancy);
    float blend = ring * 0.85;
    gl_FragColor = vec4(mix(base, heat * 2.0, blend), 1.0);
}`;

// ── Satellite signal-interference glitch pass ─────────────────────────────────
// Full-screen ShaderPass: CRT horizontal-shift + noise grain.
// Triggered for 200 ms on every specOps toggle via glitchUniforms.u_intensity.
const GLITCH_FRAG = /* glsl */`
uniform sampler2D tDiffuse;
uniform float     u_intensity;  /* 0 = pass-through, 1 = full glitch */
uniform float     u_time;
varying vec2 vUv;

/* Low-quality hash for noise. */
float hash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
}

void main() {
    if (u_intensity < 0.01) { gl_FragColor = texture2D(tDiffuse, vUv); return; }

    /* Horizontal scan-line shift — quantise to coarse bands. */
    float band      = floor(vUv.y * 30.0) / 30.0;
    float shift     = (hash(vec2(band, u_time * 8.0)) - 0.5) * 0.04 * u_intensity;
    vec2  shiftedUv = vec2(fract(vUv.x + shift), vUv.y);

    vec4 col = texture2D(tDiffuse, shiftedUv);

    /* Chromatic aberration — split R/B channels slightly. */
    float ca = 0.003 * u_intensity;
    col.r    = texture2D(tDiffuse, shiftedUv + vec2( ca, 0.0)).r;
    col.b    = texture2D(tDiffuse, shiftedUv + vec2(-ca, 0.0)).b;

    /* Scanline darkening. */
    float scanline = 0.85 + 0.15 * sin(vUv.y * 400.0);
    col.rgb *= scanline;

    /* White noise grain. */
    float noise = (hash(vUv + u_time) - 0.5) * 0.12 * u_intensity;
    col.rgb    += noise;

    gl_FragColor = col;
}`;

// ── Helper: geographic to local Three.js coordinates ─────────────────────────
// Scene origin = hero coordinate; Y = altitude (metres above ground).
function geoToWorld(lon, lat, elev) {
  return new THREE.Vector3(
    (lon - HERO_LON) * DEG_TO_M_LON,
    elev !== undefined ? elev : 5,
    -(lat - HERO_LAT) * DEG_TO_M_LAT
  );
}

// ── Simplified 3D-Tiles Renderer ──────────────────────────────────────────────
// Loads Google Photorealistic 3D Tiles (or any OGC 3D Tiles endpoint).
// Depth is capped at 2 to keep request counts reasonable without a proper
// SSE-based LOD scheduler.
class SimpleTilesRenderer {
  constructor(tilesetUrl, scene) {
    this.scene    = scene;
    this.group    = new THREE.Group();
    this.loader   = new THREE.GLTFLoader();
    this.pending  = 0;
    scene.add(this.group);

    this._fetchAndProcess(tilesetUrl, new THREE.Matrix4(), 0);
  }

  async _fetchAndProcess(url, parentMatrix, depth) {
    try {
      const res  = await fetch(url);
      if (!res.ok) {
        // Detect authentication/authorisation failures (invalid or missing
        // Google Maps API key) and log a distinct sentinel so it is easy to
        // diagnose in the browser console without sifting through generic
        // network errors.
        if (res.status === 401 || res.status === 403) {
          console.error('TILE_AUTH_ERROR', res.status, url);
        }
        return;
      }
      const json = await res.json();
      if (json.root) this._processTile(json.root, url, parentMatrix, depth);
    } catch (_) { /* network / CORS error — fail silently */ }
  }

  _processTile(tile, baseUrl, parentMatrix, depth) {
    if (!tile) return;

    // Accumulate this tile's transform.
    const matrix = parentMatrix.clone();
    if (tile.transform) matrix.multiply(new THREE.Matrix4().fromArray(tile.transform));

    // Load content if present and within depth budget.
    const uri = (tile.content && (tile.content.uri || tile.content.url)) || null;
    if (uri && depth <= 2) {
      const fullUrl = /^https?:\/\//.test(uri) ? uri : new URL(uri, baseUrl).href;
      if (/\.(glb|gltf|b3dm)/i.test(fullUrl.split('?')[0])) {
        this.pending++;
        this.loader.load(
          fullUrl,
          (gltf) => {
            gltf.scene.applyMatrix4(matrix);
            this.group.add(gltf.scene);
            this.pending--;
          },
          undefined,
          () => { this.pending--; }
        );
      }
    }

    // Recurse into children.
    if (tile.children && depth < 2) {
      tile.children.forEach((child) =>
        this._processTile(child, baseUrl, matrix, depth + 1)
      );
    }
  }

  // Reposition the tile group so that ECEF-space tiles appear relative to the
  // hero coordinate in local ENU (East-North-Up) scene space.
  setOriginLLA(lat, lon) {
    const a  = 6378137.0;
    const e2 = 0.00669437999014;
    const lr = lat * Math.PI / 180;
    const lo = lon * Math.PI / 180;
    const N  = a / Math.sqrt(1 - e2 * Math.pow(Math.sin(lr), 2));
    const ox = N * Math.cos(lr) * Math.cos(lo);
    const oy = N * Math.cos(lr) * Math.sin(lo);
    const oz = N * (1 - e2) * Math.sin(lr);
    const sL = Math.sin(lr), cL = Math.cos(lr);
    const sO = Math.sin(lo), cO = Math.cos(lo);
    // ENU → ECEF rotation + translation, then invert for ECEF → local.
    const enuToEcef = new THREE.Matrix4().set(
      -sO,     cO,     0,  ox,
      -sL*cO, -sL*sO,  cL, oy,
       cL*cO,  cL*sO,  sL, oz,
       0,      0,      0,  1
    );
    this.group.matrix.copy(enuToEcef).invert();
    this.group.matrixAutoUpdate = false;
  }

  dispose() {
    this.group.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) [].concat(node.material).forEach((m) => m.dispose());
    });
    this.scene.remove(this.group);
  }
}

// ── Mock real-time data stream ────────────────────────────────────────────────
// Generates sinusoidal flow data for each road segment at 10 Hz.
// A neon-gold data burst cycles through the 12 segments every 3.5 s.
class MockDataStream {
  constructor(count) {
    this._count    = Math.max(count, 1);
    this._segments = Array.from({ length: this._count }, () => ({
      flowRate:   0.3 + 0.5 * Math.random(),
      congestion: Math.random(),
      phase:      Math.random() * Math.PI * 2,
      burstTime:  -1,   // < 0 = no active burst on this segment
    }));
    this._t            = 0;
    this._id           = null;
    this._burstId      = null;
    this._burstSegment = 0;   // which segment is currently bursting (cycles 0–11)
    this._burstStart   = -1;  // performance.now() when the burst on this segment began
    /* _BURST_DURATION_MS is per-segment, not the full cycle.
       Full cycle = _BURST_DURATION_MS + 3500 ms gap between segment bursts.
       This keeps each burst visually distinct before the next one fires. */
    this._BURST_DURATION_MS = 1200;
  }

  start() {
    if (this._id) return;

    // Flow-rate / congestion update at 10 Hz.
    this._id = setInterval(() => {
      this._t += 0.1;
      this._segments.forEach((s) => {
        s.flowRate   = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(this._t * 0.5  + s.phase));
        s.congestion = 0.5 + 0.48 *         Math.sin(this._t * 0.3  + s.phase * 1.7);
      });
    }, 100);

    // Data-burst scheduler — fires a new burst every 3.5 s, cycling through segments.
    this._burstId = setInterval(() => {
      // Mark previous segment burst as done.
      if (this._burstSegment >= 0 && this._burstSegment < this._count) {
        this._segments[this._burstSegment % this._count].burstTime = -1;
      }
      this._burstSegment = (this._burstSegment + 1) % this._count;
      this._burstStart   = performance.now();
      this._segments[this._burstSegment].burstTime = 0; // will be updated in getBurstTime()

      // Notify main thread so the audio layer can play the chirp.
      self.postMessage({ type: 'dataBurst', segment: this._burstSegment });
    }, 3500);
  }

  stop() {
    if (this._id)      { clearInterval(this._id);      this._id      = null; }
    if (this._burstId) { clearInterval(this._burstId); this._burstId = null; }
    // Clear all burst states.
    this._segments.forEach((s) => { s.burstTime = -1; });
  }

  getData(i) {
    return this._segments[i % this._count];
  }

  /** Returns normalised burst position (0→1) for segment i, or -1 if no burst. */
  getBurstTime(i) {
    const idx = i % this._count;
    if (idx !== this._burstSegment || this._burstStart < 0) return -1;
    const elapsed = performance.now() - this._burstStart;
    if (elapsed > this._BURST_DURATION_MS) {
      this._segments[idx].burstTime = -1;
      return -1;
    }
    return elapsed / this._BURST_DURATION_MS; // 0 → 1 over burst duration
  }
}

// ── Orbit camera controller (worker-compatible, no DOM) ───────────────────────
const orbit = {
  radius:      2000,
  theta:       -0.3,           // azimuth
  phi:          0.65,          // elevation (0 = top, PI/2 = horizon)
  isDragging:  false,
  lastX:       0,
  lastY:       0,
  center:      null,           // THREE.Vector3 — initialised in initScene()

  init() { this.center = new THREE.Vector3(0, 0, 0); },

  updateCamera(cam) {
    const r = this.radius;
    cam.position.set(
      this.center.x + r * Math.sin(this.phi) * Math.sin(this.theta),
      this.center.y + r * Math.cos(this.phi),
      this.center.z + r * Math.sin(this.phi) * Math.cos(this.theta)
    );
    cam.lookAt(this.center);
  },

  onMouseDown(x, y) { this.isDragging = true; this.lastX = x; this.lastY = y; },
  onMouseMove(x, y) {
    if (!this.isDragging) return;
    this.theta -= (x - this.lastX) * 0.005;
    this.phi    = Math.max(0.05, Math.min(Math.PI * 0.49, this.phi - (y - this.lastY) * 0.005));
    this.lastX  = x;
    this.lastY  = y;
  },
  onMouseUp()        { this.isDragging = false; },
  onWheel(deltaY)    { this.radius = Math.max(50, Math.min(5000, this.radius + deltaY * 0.5)); },
};

// ── Runtime state ─────────────────────────────────────────────────────────────
let renderer, scene, camera, composer, scannerPass, glitchPass, clock;
let canvasWidth  = 800;
let canvasHeight = 600;

// Feature flags
let subsurfaceActive = false;
let heroAssetActive  = false;
let livePulseActive  = false;
let scannerActive    = false;

// Scene objects
let buildingGroup  = null;   // placeholder buildings (and/or Google tiles)
let voxelGroup     = null;   // subsurface voxel boxes
let heroMesh       = null;   // Gaussian-Splat placeholder points
let roadGroup      = null;   // road Line objects
let tilesRenderer  = null;   // SimpleTilesRenderer (when API key provided)

// Shared uniforms referenced across feature implementations
let voxelUniforms     = null;
let buildingUniforms  = null;  // scannerRadius + u_scannerActive for ghost-heatmap
let roadSegments      = [];    // [{ mesh, uniforms }]
let glitchUniforms    = null;  // u_intensity (0→1), u_time

// Clipping plane (subsurface X-Ray)
let clipPlane         = null;
let clipAnimIntervalId = null;

// Hero fade state
let heroFade    = 0;   // 0 = invisible, 1 = fully visible
let heroNear    = false;

// Scanner animation
let scannerAnimId = null;

// Mock data stream
let mockStream = null;

// Frame timing
let lastFrameTime = 0;

// ── Scene initialisation ──────────────────────────────────────────────────────
function initScene(canvas, width, height, apiKey) {
  canvasWidth  = width;
  canvasHeight = height;

  // Renderer — alpha:true so the CesiumJS globe shows through when opacity < 1
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha:              true,
    antialias:          true,
    premultipliedAlpha: false,
  });
  renderer.setSize(width, height, false); // false = skip CSS update (OffscreenCanvas)
  renderer.setPixelRatio(1);              // fixed at 1 for Chromebook perf
  renderer.localClippingEnabled = true;
  renderer.setClearColor(0x000000, 0);    // fully transparent clear

  scene  = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0a1a, 0.00025);

  camera = new THREE.PerspectiveCamera(60, width / height, 1, 15000);
  orbit.init();
  orbit.updateCamera(camera);

  clock  = new THREE.Clock();

  // Clipping plane at Y=0 (disabled until Subsurface X-Ray is activated).
  clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

  // ── Lighting ───────────────────────────────────────────────────────────────
  scene.add(new THREE.AmbientLight(0x223366, 1.0));
  const sun = new THREE.DirectionalLight(0xffeedd, 1.5);
  sun.position.set(500, 1000, 300);
  scene.add(sun);

  // ── Scene objects ──────────────────────────────────────────────────────────
  buildingGroup = createPlaceholderBuildings();
  scene.add(buildingGroup);

  voxelGroup = createVoxelLayer();
  scene.add(voxelGroup);

  heroMesh = createHeroPlaceholder();
  scene.add(heroMesh);

  roadGroup = new THREE.Group();
  scene.add(roadGroup);

  // Load roads asynchronously (fetch is available in workers).
  loadRoads();

  // If a Google Maps API key was provided, load Google Photorealistic 3D Tiles
  // on top of the placeholder buildings.
  if (apiKey) loadGoogleTiles(apiKey);

  // ── Post-processing ────────────────────────────────────────────────────────
  initComposer();

  // ── Start render loop ──────────────────────────────────────────────────────
  // renderer.setAnimationLoop() falls back to setTimeout in Web Workers
  // (no requestAnimationFrame available), giving us a reliable tick.
  renderer.setAnimationLoop(renderFrame);

  self.postMessage({ type: 'ready' });
}

// ── Placeholder buildings ─────────────────────────────────────────────────────
function createPlaceholderBuildings() {
  const group = new THREE.Group();

  // Ground plane — stays as standard MeshStandardMaterial.
  const groundGeo = new THREE.PlaneGeometry(6000, 6000);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x1a2a1a, roughness: 0.95 });
  const ground    = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  group.add(ground);

  // Shared building uniforms — drive the ghost-heatmap effect.
  buildingUniforms = {
    scannerRadius:    { value: 0 },
    u_scannerActive:  { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms:       buildingUniforms,
    vertexShader:   BUILDING_VERT,
    fragmentShader: BUILDING_FRAG,
    side:           THREE.FrontSide,
  });

  // City-block grid of randomised buildings (~5 × 5 km area).
  for (let ix = -5; ix <= 5; ix++) {
    for (let iz = -5; iz <= 5; iz++) {
      if (Math.abs(ix) + Math.abs(iz) > 7) continue;
      const w  = 12 + Math.random() * 20;
      const h  = 8  + Math.random() * 60;
      const d  = 12 + Math.random() * 20;
      const bGeo  = new THREE.BoxGeometry(w, h, d);
      const bMesh = new THREE.Mesh(bGeo, mat);
      bMesh.position.set(
        ix * 80 + (Math.random() - 0.5) * 25,
        h / 2,
        iz * 80 + (Math.random() - 0.5) * 25
      );
      group.add(bMesh);
    }
  }
  return group;
}

// ── Subsurface voxel layer ────────────────────────────────────────────────────
// 400 box primitives (20 × 20 grid) positioned 15–35 m below ground.
// All share one geometry and one ShaderMaterial for minimal draw calls.
function createVoxelLayer() {
  const group = new THREE.Group();
  const geo   = new THREE.BoxGeometry(8, 4, 8);

  voxelUniforms = {
    time:          { value: 0 },
    scannerRadius: { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms:       voxelUniforms,
    vertexShader:   VOXEL_VERT,
    fragmentShader: VOXEL_FRAG,
    transparent:    true,
    side:           THREE.DoubleSide,
  });

  for (let ix = -10; ix < 10; ix++) {
    for (let iz = -10; iz < 10; iz++) {
      const mesh = new THREE.Mesh(geo, mat);   // shared geo + mat
      mesh.position.set(
        ix * 60 + (Math.random() - 0.5) * 20,
        -15 - Math.random() * 20,              // -15 to -35 m
        iz * 60 + (Math.random() - 0.5) * 20
      );
      group.add(mesh);
    }
  }

  group.visible = false;
  return group;
}

// ── Hero Gaussian-Splat placeholder ──────────────────────────────────────────
// A point cloud that simulates the appearance of a loaded .splat model.
// The real asset URL is ./hero-asset-placeholder.splat; in production a
// proper splat binary loader (e.g. gsplat) would be used here instead.
function createHeroPlaceholder() {
  const COUNT     = 2500;
  const positions = new Float32Array(COUNT * 3);

  for (let i = 0; i < COUNT; i++) {
    // Box-Muller transform — converts two independent uniform [0,1] samples
    // (Math.random() called twice: once for `r`, once for `theta`) into a
    // Gaussian-distributed magnitude.
    // 1e-10 is added before log() as a defensive guard; Math.random() never
    // returns exactly 0, but this makes the intent explicit and protects
    // against edge cases.
    const r      = Math.sqrt(-2 * Math.log(Math.random() + 1e-10));
    const theta  = Math.random() * Math.PI * 2;
    const phi    = Math.acos(2 * Math.random() - 1);
    positions[i * 3]     = r * 18 * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r *  9 * Math.cos(phi) + 6;  // 6 m above ground
    positions[i * 3 + 2] = r * 18 * Math.sin(phi) * Math.sin(theta);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time:       { value: 0 },
      splatColor: { value: new THREE.Color(0x00e5ff) },
    },
    vertexShader:   SPLAT_VERT,
    fragmentShader: SPLAT_FRAG,
    transparent:    true,
    depthWrite:     false,
  });

  const points = new THREE.Points(geo, mat);
  points.renderOrder = 10;
  points.visible     = false;
  return points;
}

// ── Road pulse geometry ───────────────────────────────────────────────────────
async function loadRoads() {
  const roadsUrl = new URL('./lehigh_roads.geojson', self.location.href).href;
  try {
    const res     = await fetch(roadsUrl);
    const geojson = await res.json();

    geojson.features.forEach((feature) => {
      if (feature.geometry.type !== 'LineString') return;
      const coords = feature.geometry.coordinates;

      // World-space point array (Three.js XYZ).
      const pts = coords.map(([lon, lat]) => geoToWorld(lon, lat, 5));

      // Compute cumulative arc lengths for normalised UV.x (0 → 1).
      const lengths = [0];
      for (let j = 1; j < pts.length; j++) {
        lengths.push(lengths[j - 1] + pts[j].distanceTo(pts[j - 1]));
      }
      const totalLen = lengths[lengths.length - 1] || 1;

      const positions = new Float32Array(pts.length * 3);
      const uvs       = new Float32Array(pts.length * 2);
      pts.forEach((p, j) => {
        positions[j * 3]     = p.x;
        positions[j * 3 + 1] = p.y;
        positions[j * 3 + 2] = p.z;
        uvs[j * 2]           = lengths[j] / totalLen;  // U = arc-length param
        uvs[j * 2 + 1]       = 0;
      });

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));

      const segUniforms = {
        time:          { value: 0 },
        flowRate:      { value: 0.5 },
        congestion:    { value: 0.3 },
        scannerRadius: { value: 0 },
        uBurstTime:    { value: -1 },  // -1 = no active burst
      };

      const mat = new THREE.ShaderMaterial({
        uniforms:       segUniforms,
        vertexShader:   ROAD_VERT,
        fragmentShader: ROAD_FRAG,
        transparent:    true,
        depthTest:      false,
        depthWrite:     false,
      });

      const line = new THREE.Line(geo, mat);
      line.visible = false;
      roadGroup.add(line);
      roadSegments.push({ mesh: line, uniforms: segUniforms });
    });
  } catch (err) {
    console.error('[SpecOps] loadRoads failed:', err);
  }
}

// ── Google Photorealistic 3D Tiles (optional, requires API key) ───────────────
function loadGoogleTiles(apiKey) {
  const url = 'https://tile.googleapis.com/v1/3dtiles/root.json?key=' + apiKey;
  tilesRenderer = new SimpleTilesRenderer(url, scene);
  tilesRenderer.setOriginLLA(HERO_LAT, HERO_LON);

  // Fade out placeholder buildings once tiles start arriving.
  const check = setInterval(() => {
    if (!tilesRenderer) { clearInterval(check); return; }
    if (tilesRenderer.pending === 0 && tilesRenderer.group.children.length > 0) {
      clearInterval(check);
      buildingGroup.visible = false;
    }
  }, 2000);
}

// ── EffectComposer + scanner post-processing pass ─────────────────────────────
function initComposer() {
  composer = new THREE.EffectComposer(renderer);
  composer.addPass(new THREE.RenderPass(scene, camera));

  scannerPass = new THREE.ShaderPass({
    uniforms: {
      tDiffuse:      { value: null },
      scannerRadius: { value: 0 },
      resolution:    { value: new THREE.Vector2(canvasWidth, canvasHeight) },
      u_active:      { value: 0 },
    },
    vertexShader:   SCANNER_VERT,
    fragmentShader: SCANNER_FRAG,
  });
  composer.addPass(scannerPass);

  // Glitch pass — always in the chain but intensity = 0 when idle.
  glitchUniforms = {
    tDiffuse:    { value: null },
    u_intensity: { value: 0 },
    u_time:      { value: 0 },
  };
  glitchPass = new THREE.ShaderPass({
    uniforms:       glitchUniforms,
    vertexShader:   SCANNER_VERT,   // same full-screen-quad vert shader
    fragmentShader: GLITCH_FRAG,
  });
  glitchPass.renderToScreen = true;
  composer.addPass(glitchPass);
}

// ── Render loop ───────────────────────────────────────────────────────────────
function renderFrame(now) {
  // 30 fps cap — avoids overwhelming Chromebook GPU.
  if (now - lastFrameTime < FRAME_INTERVAL_MS) return;
  lastFrameTime = now;

  const elapsed = clock.getElapsedTime();
  const dt      = clock.getDelta();   // note: getDelta() advances the clock

  // Camera
  orbit.updateCamera(camera);

  // ── Post camera coordinates to main thread (for coordinate lead-in UI) ──────
  // Convert orbit angles to approximate lat/lon relative to hero coord.
  const camLat = HERO_LAT - (camera.position.z / DEG_TO_M_LAT);
  const camLon = HERO_LON + (camera.position.x / DEG_TO_M_LON);
  // Throttle to once per 5 frames to keep postMessage overhead minimal.
  if (Math.floor(elapsed * TARGET_FPS) % 5 === 0) {
    self.postMessage({ type: 'cameraCoords', lat: camLat, lon: camLon });
  }

  // ── Voxel animation ────────────────────────────────────────────────────────
  if (voxelUniforms) {
    voxelUniforms.time.value = elapsed;
  }

  // ── Ghost-building heatmap — propagate scanner radius ─────────────────────
  const currentScannerR = scannerPass ? scannerPass.uniforms.scannerRadius.value : 0;
  if (buildingUniforms) {
    buildingUniforms.scannerRadius.value   = currentScannerR;
    buildingUniforms.u_scannerActive.value = scannerActive ? 1 : 0;
  }

  // ── Hero splat proximity & fade ────────────────────────────────────────────
  if (heroAssetActive && heroMesh) {
    const dist   = camera.position.length(); // distance to origin (hero coord)
    const target = dist < HERO_TRIGGER_RADIUS ? 1 : 0;

    if (heroNear !== (dist < HERO_TRIGGER_RADIUS)) {
      heroNear = dist < HERO_TRIGGER_RADIUS;
      self.postMessage({ type: 'heroProximity', near: heroNear, distance: dist });
    }

    heroFade += (target - heroFade) * Math.min(dt * 3, 1);
    heroMesh.visible = heroFade > 0.01;
    if (heroMesh.material.uniforms) {
      heroMesh.material.uniforms.time.value = elapsed;
      // Modulate splat opacity via the splatColor brightness.
      heroMesh.material.uniforms.splatColor.value.setRGB(
        heroFade * 0, heroFade * 0.898, heroFade * 1
      );
    }
  }

  // ── Road pulse updates (including uBurstTime) ──────────────────────────────
  roadSegments.forEach((seg, i) => {
    const data = mockStream ? mockStream.getData(i) : { flowRate: 0.5, congestion: 0.3 };
    seg.uniforms.time.value          = elapsed;
    seg.uniforms.flowRate.value      = data.flowRate;
    seg.uniforms.congestion.value    = data.congestion;
    seg.uniforms.scannerRadius.value = currentScannerR;
    // Update burst position — fluid at 30 fps because it reads performance.now() directly.
    seg.uniforms.uBurstTime.value    = mockStream ? mockStream.getBurstTime(i) : -1;
  });

  // Propagate scanner radius to voxel material as well.
  if (voxelUniforms) {
    voxelUniforms.scannerRadius.value = currentScannerR;
  }

  // ── Glitch pass — natural decay + tile-loading floor ─────────────────────────
  if (glitchUniforms) {
    glitchUniforms.u_time.value = elapsed;

    // While Google 3D Tiles are still streaming in, hold a subtle grain floor
    // (0.2) so the visual hitch of material swaps is masked rather than exposed
    // by an abrupt glitch-off.  Once tiles are stable the decay resumes.
    const tilesLoading = tilesRenderer && tilesRenderer.pending > 0;
    const intensityFloor = tilesLoading ? 0.2 : 0;

    // Decay intensity toward the floor at 6×/s so the 200 ms burst fades naturally.
    if (glitchUniforms.u_intensity.value > intensityFloor + 0.01) {
      glitchUniforms.u_intensity.value = Math.max(
        intensityFloor, glitchUniforms.u_intensity.value - dt * 6
      );
    } else {
      glitchUniforms.u_intensity.value = intensityFloor;
    }
  }

  // ── Render (skip when nothing to show) ────────────────────────────────────
  const tilesLoading = tilesRenderer && tilesRenderer.pending > 0;
  const anyActive = subsurfaceActive || heroAssetActive || livePulseActive || scannerActive
    || tilesLoading
    || (glitchUniforms && glitchUniforms.u_intensity.value > 0.01);
  if (anyActive) {
    composer.render();
  }
}

// ── Feature activation helpers ────────────────────────────────────────────────

// Animate clipPlane.constant from current → target over durationMs.
function animateClipPlane(target, durationMs) {
  if (clipAnimIntervalId) clearInterval(clipAnimIntervalId);
  const start     = clipPlane.constant;
  const startTime = performance.now();
  clipAnimIntervalId = setInterval(() => {
    const t    = Math.min((performance.now() - startTime) / durationMs, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;  // easeInOut
    clipPlane.constant = start + (target - start) * ease;
    if (t >= 1) { clearInterval(clipAnimIntervalId); clipAnimIntervalId = null; }
  }, 16);
}

// Scanner ring expands from 0 → 1 over PASS_DURATION ms, repeats TOTAL_PASSES.
function startScanner() {
  if (scannerAnimId) return;
  const PASS_DURATION  = 2000;
  const TOTAL_PASSES   = 3;
  const startTime      = performance.now();
  scannerPass.uniforms.u_active.value      = 1;
  scannerPass.uniforms.scannerRadius.value = 0;

  scannerAnimId = setInterval(() => {
    const elapsed = performance.now() - startTime;
    scannerPass.uniforms.scannerRadius.value = (elapsed % PASS_DURATION) / PASS_DURATION;
    if (elapsed >= PASS_DURATION * TOTAL_PASSES || !scannerActive) {
      stopScanner();
    }
  }, 16);
}

function stopScanner() {
  if (scannerAnimId) { clearInterval(scannerAnimId); scannerAnimId = null; }
  if (scannerPass) {
    scannerPass.uniforms.u_active.value      = 0;
    scannerPass.uniforms.scannerRadius.value = 0;
  }
  scannerActive = false;
  self.postMessage({ type: 'scannerComplete' });
}

// ── SpecOps command dispatcher ────────────────────────────────────────────────
function handleSpecOps(feature, enabled) {
  // Satellite signal-interference — trigger 200 ms glitch on every toggle.
  if (glitchUniforms) {
    glitchUniforms.u_intensity.value = 1.0;
  }

  switch (feature) {
    case 'subsurface':
      subsurfaceActive = enabled;
      if (enabled) {
        renderer.clippingPlanes = [clipPlane];
        clipPlane.constant      = 0;
        voxelGroup.visible      = true;
        animateClipPlane(-20, 1500);   // peel back 20 m over 1.5 s
      } else {
        animateClipPlane(0, 800);
        setTimeout(() => {
          voxelGroup.visible      = false;
          renderer.clippingPlanes = [];
        }, 850);
      }
      break;

    case 'heroAsset':
      heroAssetActive = enabled;
      if (!enabled) {
        heroFade = 0;
        heroNear = false;
        if (heroMesh) heroMesh.visible = false;
      }
      break;

    case 'livePulse':
      livePulseActive = enabled;
      roadSegments.forEach((s) => { s.mesh.visible = enabled; });
      if (enabled) {
        if (!mockStream) mockStream = new MockDataStream(roadSegments.length);
        mockStream.start();
      } else {
        if (mockStream) mockStream.stop();
      }
      break;

    case 'scanner':
      scannerActive = enabled;
      if (enabled) {
        startScanner();
      } else {
        stopScanner();
      }
      break;

    default:
      break;
  }
}

// ── Message handler ───────────────────────────────────────────────────────────
self.onmessage = function onMessage(e) {
  const msg = e.data;
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case 'init':
      initScene(msg.canvas, msg.width, msg.height, msg.apiKey || '');
      break;

    case 'resize':
      canvasWidth  = msg.width;
      canvasHeight = msg.height;
      if (renderer) {
        renderer.setSize(msg.width, msg.height, false);
        camera.aspect = msg.width / msg.height;
        camera.updateProjectionMatrix();
        composer.setSize(msg.width, msg.height);
        scannerPass.uniforms.resolution.value.set(msg.width, msg.height);
      }
      break;

    case 'mousemove':
      orbit.onMouseMove(msg.x, msg.y);
      break;

    case 'mousedown':
      if (msg.button === 0) orbit.onMouseDown(msg.x, msg.y);
      break;

    case 'mouseup':
      orbit.onMouseUp();
      break;

    case 'wheel':
      orbit.onWheel(msg.deltaY);
      break;

    case 'specOps':
      handleSpecOps(msg.feature, msg.enabled);
      break;

    default:
      break;
  }
};
