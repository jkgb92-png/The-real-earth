/**
 * packages/shaders/src/canvas_dpr.ts
 *
 * Device Pixel Ratio (DPR) helper for React Three Fiber Canvas on high-DPI
 * displays including Chromebooks, Retina MacBooks, and 4K monitors.
 *
 * Context
 * -------
 * This app runs on Next.js (not Vite), so there is no vite.config.ts to
 * modify.  The R3F <Canvas> accepts a `dpr` prop that maps directly to
 * Three.js WebGLRenderer.setPixelRatio().
 *
 * Chromebook note
 * ---------------
 * Chrome OS reports window.devicePixelRatio values between 1.25 and 2.0
 * depending on the display density setting.  Rendering at the full native
 * DPR on those panels (often 2.0×) doubles the number of fragment shader
 * invocations per frame.  Capping at 2 keeps GPU load manageable while
 * still delivering a perceptibly sharp result.
 *
 * Usage — React Three Fiber (Next.js / app router)
 * ------------------------------------------------
 * ```tsx
 * 'use client';
 * import { Canvas } from '@react-three/fiber';
 * import { getCanvasDpr } from '@the-real-earth/shaders';
 *
 * export function GlobeCanvas() {
 *   return (
 *     <Canvas
 *       dpr={getCanvasDpr()}
 *       gl={{ antialias: true, powerPreference: 'high-performance' }}
 *     >
 *       {/* scene … *\/}
 *     </Canvas>
 *   );
 * }
 * ```
 *
 * The `dpr` prop accepts either a number or a [min, max] tuple.
 * Passing a tuple lets R3F pick the actual DPR at runtime (useful when SSR
 * renders with `devicePixelRatio === 1`):
 *
 * ```tsx
 * <Canvas dpr={[1, 2]} …>
 * ```
 *
 * `getCanvasDpr()` returns the tuple form so it works correctly in both
 * client-side and SSR (Next.js) contexts.
 */

/**
 * Maximum DPR cap.
 *
 * 2 is the sweet spot: covers all Retina / HiDPI displays (iPhone, Retina
 * Mac, Chromebook) while avoiding the 4× framebuffer cost of 2× DPR rendered
 * at 2× again (some Android flagships report 3.0 or higher).
 *
 * Raise to 3 only if you are targeting devices where the difference between
 * 2× and 3× is perceptible AND you have confirmed frame-rate headroom.
 */
export const MAX_DPR = 2;

/**
 * Return the [min, max] DPR tuple for the React Three Fiber `<Canvas dpr>` prop.
 *
 * - min is always 1 (SSR / low-end fallback renders at 1:1).
 * - max is `Math.min(window.devicePixelRatio, MAX_DPR)` on the client,
 *   or MAX_DPR when `window` is undefined (Next.js SSR / Edge runtime).
 *
 * Passing a tuple instead of a fixed number means R3F will re-evaluate it
 * whenever the window DPR changes (e.g. user moves the window to a different
 * monitor).
 *
 * @returns  [1, cappedDpr]  e.g. [1, 2] on a Retina Chromebook
 */
export function getCanvasDpr(): [number, number] {
  const deviceDpr =
    typeof window !== 'undefined' ? (window.devicePixelRatio ?? 1) : 1;
  return [1, Math.min(deviceDpr, MAX_DPR)];
}

/**
 * Next.js-specific note on renderer pixel ratio.
 *
 * Unlike Vite (which exposes `import.meta.env` + vite.config.ts plugins),
 * Next.js delegates rendering to the React Three Fiber <Canvas> via the
 * `dpr` prop shown above.  There is no separate pixelRatio config in
 * next.config.js — the Canvas prop is the single source of truth.
 *
 * If you are also using @react-three/postprocessing (EffectComposer), ensure
 * the composer's render target matches the canvas DPR:
 *
 * ```tsx
 * <EffectComposer multisampling={4} resolutionScale={1} />
 * ```
 *
 * `resolutionScale={1}` (default) keeps the composer's render target at the
 * same size as the Canvas, which already respects the `dpr` setting.
 */
export const CANVAS_DPR_NOTE =
  'Pass dpr={getCanvasDpr()} to <Canvas> — the tuple form [min, max] ' +
  'lets R3F pick the real DPR at runtime, which is correct for Next.js SSR.';
