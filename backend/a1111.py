"""
backend/a1111.py

AUTOMATIC1111 Stable Diffusion WebUI client.

Provides AI-powered image-to-image (img2img) enhancement for satellite tiles
via the AUTOMATIC1111 REST API (POST /sdapi/v1/img2img).

Enhancement pipeline
--------------------
1. Accept raw image bytes (any PIL-supported format: PNG / JPEG / WebP).
2. Read the image dimensions so the output tile matches the source size.
3. Base64-encode the image and POST it to the A1111 img2img endpoint.
4. Decode the first result image from the base64 response and return the bytes.

The function is stateless — the A1111 server URL is passed in explicitly from
tile_server.py (which reads it from Settings.a1111_url) so the module is easy
to unit-test without patching module-level globals.
"""

from __future__ import annotations

import base64
import io
from typing import Optional

import httpx
from PIL import Image

# Default prompt tuned for satellite / aerial-imagery enhancement.
_DEFAULT_PROMPT = (
    "satellite imagery, aerial photograph, high resolution, "
    "detailed terrain, crisp details, photorealistic"
)
_DEFAULT_NEGATIVE = "blur, noise, artifacts, distortion, unrealistic colors"
_DEFAULT_STEPS = 20
_DEFAULT_CFG = 7.0


async def enhance_image(
    image_bytes: bytes,
    a1111_url: str,
    prompt: Optional[str] = None,
    negative_prompt: str = _DEFAULT_NEGATIVE,
    denoising_strength: float = 0.25,
) -> bytes:
    """
    Submit *image_bytes* to the AUTOMATIC1111 img2img endpoint and return
    the AI-enhanced image as PNG bytes.

    Parameters
    ----------
    image_bytes:
        Raw bytes of the source image (any PIL-supported format).
    a1111_url:
        Base URL of the running AUTOMATIC1111 server
        (e.g. ``http://localhost:7860``).
    prompt:
        Enhancement prompt.  Uses a default satellite-tuned prompt when
        ``None``.
    negative_prompt:
        Negative guidance prompt (default discourages blur / noise).
    denoising_strength:
        img2img denoising strength in [0, 1].  Lower values preserve more
        of the original image; higher values allow more creative deviation.
        ``0.25`` sharpens fine detail without altering tile content.

    Returns
    -------
    bytes
        PNG-encoded bytes of the enhanced image.

    Raises
    ------
    httpx.HTTPStatusError
        When the A1111 server returns a non-2xx HTTP response.
    httpx.HTTPError
        On network / connection errors.
    ValueError
        When the A1111 response contains no images.
    """
    effective_prompt = prompt if prompt else _DEFAULT_PROMPT

    # Read dimensions so the A1111 output tile matches the source size.
    with Image.open(io.BytesIO(image_bytes)) as img:
        width, height = img.size

    encoded = base64.b64encode(image_bytes).decode("utf-8")

    payload: dict = {
        "init_images": [encoded],
        "prompt": effective_prompt,
        "negative_prompt": negative_prompt,
        "steps": _DEFAULT_STEPS,
        "cfg_scale": _DEFAULT_CFG,
        "denoising_strength": denoising_strength,
        "width": width,
        "height": height,
        "sampler_name": "Euler a",
        "batch_size": 1,
        "n_iter": 1,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(f"{a1111_url}/sdapi/v1/img2img", json=payload)

    resp.raise_for_status()

    data = resp.json()
    images = data.get("images")
    if not images:
        raise ValueError("A1111 response contained no images")

    # The API returns a base64-encoded PNG; strip any data-URI prefix.
    result_b64: str = images[0]
    if "," in result_b64:
        result_b64 = result_b64.split(",", 1)[1]

    return base64.b64decode(result_b64)
