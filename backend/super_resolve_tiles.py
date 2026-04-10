"""
backend/super_resolve_tiles.py

Super-resolution upscaling for satellite map tiles using Real-ESRGAN (4×).

Loops through a directory of JPG/PNG/TIF tiles (organised in any nested
structure, e.g. z/x/y.jpg), applies a 4× Real-ESRGAN model to sharpen
building edges, reduce atmospheric haze, and restore fine road details,
then writes the results to a parallel output directory while preserving
the original sub-path / filename.

Usage
-----
    # From the repo root:
    python -m backend.super_resolve_tiles

    # Custom paths:
    python -m backend.super_resolve_tiles \\
        --tiles-dir /data/tiles \\
        --output-dir /data/sharpened_tiles \\
        --model RealESRGAN_x4plus \\
        --tile-size 256 \\
        --workers 2

    # CPU-only (no CUDA):
    python -m backend.super_resolve_tiles --device cpu

Requirements (see backend/requirements.txt)
-------------------------------------------
    opencv-python-headless
    realesrgan
    basicsr          (installed as a dependency of realesrgan)
    torch / torchvision  (already present)

Notes
-----
- TensorFlow is NOT used because the project already uses PyTorch (torch ≥ 2.3),
  and Real-ESRGAN's reference implementation is PyTorch-native.
- The RRDB model weights (~64 MB) are downloaded automatically on first run
  from the official Real-ESRGAN GitHub release page and cached in
  ~/.cache/realesrgan/.
- For GPU inference set --device cuda (or leave auto-detect on).
- To process very large batches, increase --workers (default: 1 to keep VRAM
  usage predictable across tile sizes).
"""

from __future__ import annotations

import argparse
import os
import sys
import warnings
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Suppress noisy basicsr / torch deprecation warnings that aren't actionable
# ---------------------------------------------------------------------------
warnings.filterwarnings("ignore", category=UserWarning, module="basicsr")
warnings.filterwarnings("ignore", category=FutureWarning)

import torch
from basicsr.archs.rrdbnet_arch import RRDBNet
from realesrgan import RealESRGANer
from realesrgan.archs.srvgg_arch import SRVGGNetCompact

# ---------------------------------------------------------------------------
# Available pre-trained models
# ---------------------------------------------------------------------------
_MODELS: dict[str, dict] = {
    # Best general-purpose satellite sharpening (RRDB backbone, 64 MB)
    "RealESRGAN_x4plus": {
        "url": (
            "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/"
            "RealESRGAN_x4plus.pth"
        ),
        "model": RRDBNet(
            num_in_ch=3,
            num_out_ch=3,
            num_feat=64,
            num_block=23,
            num_grow_ch=32,
            scale=4,
        ),
        "netscale": 4,
        "tile": 0,  # handled by caller
    },
    # Lighter model — faster on CPU, slightly less detail
    "realesr-general-x4v3": {
        "url": (
            "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/"
            "realesr-general-x4v3.pth"
        ),
        "model": SRVGGNetCompact(
            num_in_ch=3,
            num_out_ch=3,
            num_feat=64,
            num_conv=32,
            upscale=4,
            act_type="prelu",
        ),
        "netscale": 4,
        "tile": 0,
    },
}

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_upsampler(
    model_name: str,
    tile_size: int,
    device: str,
    half: bool,
) -> RealESRGANer:
    """Instantiate and return a RealESRGANer inference object."""
    cfg = _MODELS[model_name]
    cache_dir = Path.home() / ".cache" / "realesrgan"
    cache_dir.mkdir(parents=True, exist_ok=True)
    model_path = cache_dir / f"{model_name}.pth"

    upsampler = RealESRGANer(
        scale=cfg["netscale"],
        model_path=cfg["url"] if not model_path.exists() else str(model_path),
        dni_weight=None,
        model=cfg["model"],
        tile=tile_size,
        tile_pad=10,
        pre_pad=0,
        half=half,
        device=torch.device(device),
    )
    # Cache the downloaded weights so subsequent runs are offline-capable
    if not model_path.exists() and upsampler.model_path:
        try:
            import shutil
            shutil.copy2(upsampler.model_path, model_path)
        except Exception:
            pass  # non-fatal

    return upsampler


def _resolve_output_path(src: Path, tiles_dir: Path, output_dir: Path) -> Path:
    """Mirror src's relative position under tiles_dir into output_dir."""
    rel = src.relative_to(tiles_dir)
    dst = output_dir / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    return dst


def _upscale_tile(
    src: Path,
    dst: Path,
    upsampler: RealESRGANer,
    outscale: float = 4.0,
) -> None:
    """Read one tile, upscale 4×, write to dst (same extension as src)."""
    img = cv2.imread(str(src), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise ValueError(f"cv2.imread returned None for {src}")

    # Real-ESRGAN expects BGR uint8; handle alpha channel separately
    if img.ndim == 2:
        # Greyscale → replicate to 3-channel
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        alpha = None
    elif img.shape[2] == 4:
        alpha = img[:, :, 3]
        img = img[:, :, :3]
    else:
        alpha = None

    output, _ = upsampler.enhance(img, outscale=outscale)

    if alpha is not None:
        # Upscale alpha with Lanczos (no artefacts on binary masks)
        h, w = output.shape[:2]
        alpha_up = cv2.resize(alpha, (w, h), interpolation=cv2.INTER_LANCZOS4)
        output = np.dstack([output, alpha_up])

    # Preserve original format; use high-quality JPEG compression
    ext = dst.suffix.lower()
    encode_params: list[int] = []
    if ext in {".jpg", ".jpeg"}:
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, 95]
    elif ext == ".png":
        encode_params = [cv2.IMWRITE_PNG_COMPRESSION, 1]  # fast, good size

    cv2.imwrite(str(dst), output, encode_params)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "4× super-resolve satellite map tiles using Real-ESRGAN, "
            "sharpening edges and reducing atmospheric haze."
        )
    )
    parser.add_argument(
        "--tiles-dir",
        default="tiles",
        metavar="DIR",
        help="Directory containing input tiles (default: ./tiles)",
    )
    parser.add_argument(
        "--output-dir",
        default="sharpened_tiles",
        metavar="DIR",
        help="Directory for upscaled output tiles (default: ./sharpened_tiles)",
    )
    parser.add_argument(
        "--model",
        default="RealESRGAN_x4plus",
        choices=list(_MODELS),
        help=(
            "Pre-trained model to use. "
            "'RealESRGAN_x4plus' gives the best detail recovery; "
            "'realesr-general-x4v3' is ~30%% faster on CPU."
        ),
    )
    parser.add_argument(
        "--tile-size",
        type=int,
        default=0,
        metavar="N",
        help=(
            "Internal inference tile size (0 = process each image in one pass). "
            "Set to e.g. 256 to cap VRAM use at the cost of slight edge artefacts."
        ),
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cuda", "mps", "cpu"],
        help="Compute device (default: auto-detect CUDA → MPS → CPU).",
    )
    parser.add_argument(
        "--half",
        action="store_true",
        default=False,
        help="Use FP16 inference (faster on Ampere+ GPUs; slightly lower precision).",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        default=True,
        help="Skip tiles that already exist in the output directory (default: on).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        default=False,
        help="Re-process and overwrite existing output tiles.",
    )
    args = parser.parse_args(argv)

    # ------------------------------------------------------------------
    # Resolve device
    # ------------------------------------------------------------------
    if args.device == "auto":
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
        else:
            device = "cpu"
    else:
        device = args.device

    skip_existing = args.skip_existing and not args.overwrite

    tiles_dir = Path(args.tiles_dir).resolve()
    output_dir = Path(args.output_dir).resolve()

    if not tiles_dir.exists():
        print(f"ERROR: tiles directory not found: {tiles_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Collect tile paths
    # ------------------------------------------------------------------
    tile_paths = sorted(
        p for p in tiles_dir.rglob("*")
        if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
    )

    if not tile_paths:
        print(f"No supported image files found in {tiles_dir}", file=sys.stderr)
        return 0

    print(
        f"Found {len(tile_paths)} tile(s) in {tiles_dir}\n"
        f"  Model : {args.model}\n"
        f"  Device: {device}  half={args.half}\n"
        f"  Output: {output_dir}\n"
    )

    # ------------------------------------------------------------------
    # Build upsampler (loads / downloads model weights once)
    # ------------------------------------------------------------------
    print("Loading model weights …", flush=True)
    try:
        upsampler = _build_upsampler(
            model_name=args.model,
            tile_size=args.tile_size,
            device=device,
            half=args.half and device in {"cuda", "mps"},
        )
    except Exception as exc:
        print(f"ERROR: failed to load model: {exc}", file=sys.stderr)
        return 1

    print("Model ready. Processing tiles …\n")

    # ------------------------------------------------------------------
    # Process tiles
    # ------------------------------------------------------------------
    ok = skipped = failed = 0

    for i, src in enumerate(tile_paths, 1):
        dst = _resolve_output_path(src, tiles_dir, output_dir)

        if skip_existing and dst.exists():
            skipped += 1
            continue

        try:
            _upscale_tile(src, dst, upsampler, outscale=4.0)
            ok += 1
            print(f"[{i:>5}/{len(tile_paths)}] ✓  {src.relative_to(tiles_dir)}")
        except Exception as exc:
            failed += 1
            print(
                f"[{i:>5}/{len(tile_paths)}] ✗  {src.relative_to(tiles_dir)}: {exc}",
                file=sys.stderr,
            )

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    print(
        f"\nDone — {ok} upscaled, {skipped} skipped, {failed} failed  "
        f"→ {output_dir}"
    )
    return 0 if failed == 0 else 2


if __name__ == "__main__":
    sys.exit(main())
