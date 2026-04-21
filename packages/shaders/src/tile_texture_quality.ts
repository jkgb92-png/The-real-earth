/**
 * packages/shaders/src/tile_texture_quality.ts
 *
 * Texture quality utilities for NASA GIBS and Bathymetry tile textures loaded
 * into Three.js scenes.
 *
 * Problem: tile textures look blurry/soft at mid-to-high zoom because the
 * default Three.js NearestFilter (or LinearMipmapLinearFilter) does not use
 * hardware anisotropy, and magFilter defaults to LinearFilter but anisotropy
 * is left at 1.
 *
 * Solution: set both filters to LinearFilter and push anisotropy to the GPU
 * maximum.  Call applyTileTextureQuality() inside the texture's `onLoad`
 * callback or in a useTexture / useLoader callback in React Three Fiber.
 *
 * Usage (R3F / drei):
 * -------------------
 *   const texture = useLoader(TextureLoader, url);
 *   const { gl } = useThree();
 *   applyTileTextureQuality(texture, gl);
 *
 * Usage (vanilla Three.js):
 * -------------------------
 *   const loader = new THREE.TextureLoader();
 *   loader.load(url, (texture) => {
 *     applyTileTextureQuality(texture, renderer);
 *     mesh.material.map = texture;
 *     mesh.material.needsUpdate = true;
 *   });
 */

// Three.js numeric constants (stable across all r100+ releases).
// Using literal numbers keeps this file free of a hard three.js peer-import
// so the shaders package stays renderer-agnostic.
const LinearFilter = 1006;            // THREE.LinearFilter
const LinearMipmapLinearFilter = 1008; // THREE.LinearMipmapLinearFilter

/**
 * Duck-typed subset of THREE.Texture that this utility needs to write.
 * A real THREE.Texture satisfies this interface.
 */
export interface TileTextureLike {
  magFilter: number;
  minFilter: number;
  anisotropy: number;
  generateMipmaps: boolean;
  needsUpdate: boolean;
}

/**
 * Duck-typed subset of THREE.WebGLRenderer that this utility reads.
 * A real THREE.WebGLRenderer satisfies this interface.
 */
export interface RendererCapabilitiesLike {
  capabilities: {
    getMaxAnisotropy(): number;
  };
}

/**
 * Apply optimal texture filtering to a single tile texture.
 *
 * - magFilter → LinearFilter          (bilinear magnification, no blockiness)
 * - minFilter → LinearMipmapLinearFilter  (trilinear minification with mipmaps)
 * - anisotropy → GPU max              (crisp at oblique angles / high zoom)
 *
 * Call this once per texture, immediately after it is loaded.
 *
 * @param texture   The tile texture to configure (THREE.Texture or compatible).
 * @param renderer  The active WebGLRenderer (used to query max anisotropy).
 */
export function applyTileTextureQuality(
  texture: TileTextureLike,
  renderer: RendererCapabilitiesLike,
): void {
  texture.magFilter = LinearFilter;
  // Trilinear filtering requires mipmaps; enable them so Three.js generates
  // them automatically on upload.  For tiles that already have mipmaps baked
  // in (e.g. KTX2) this is a no-op.
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.needsUpdate = true;
}
