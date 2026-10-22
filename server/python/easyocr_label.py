#!/usr/bin/env python3
"""Run EasyOCR on a label image; print plain text lines to stdout.

Environment (optional):
  EASYOCR_QUANTIZE=1          — quantized Reader (faster CPU, slight accuracy tradeoff)
  EASYOCR_DECODER=wordbeamsearch | beamsearch | greedy
  EASYOCR_BEAM_WIDTH=5
  EASYOCR_MAG_RATIO=1.5         — upscale before detection (default in library ~1)
  EASYOCR_CANVAS_SIZE=2560      — max edge for detector; larger images are downscaled to fit
  EASYOCR_ADJUST_CONTRAST=0.7   — 0 disables internal contrast adjust in readtext
  EASYOCR_TEXT_THRESHOLD=0.7
  EASYOCR_LOW_TEXT=0.4
  EASYOCR_LINK_THRESHOLD=0.4
  EASYOCR_ALLOWLIST=...         — restrict recognition charset (label-friendly)
"""
from __future__ import annotations

import os
import sys


def _env_float(name: str) -> float | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    return float(raw)


def _env_int(name: str) -> int | None:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return None
    return int(raw)


def _readtext_kwargs() -> dict:
    kw: dict = {"detail": 0}

    for env_name, arg_name in (
        ("EASYOCR_MAG_RATIO", "mag_ratio"),
        ("EASYOCR_CANVAS_SIZE", "canvas_size"),
        ("EASYOCR_ADJUST_CONTRAST", "adjust_contrast"),
        ("EASYOCR_TEXT_THRESHOLD", "text_threshold"),
        ("EASYOCR_LOW_TEXT", "low_text"),
        ("EASYOCR_LINK_THRESHOLD", "link_threshold"),
    ):
        value = _env_float(env_name)
        if value is not None:
            kw[arg_name] = value

    allowlist = os.environ.get("EASYOCR_ALLOWLIST", "").strip()
    if allowlist:
        kw["allowlist"] = allowlist

    decoder = os.environ.get("EASYOCR_DECODER", "").strip()
    if decoder:
        kw["decoder"] = decoder
    beam = _env_int("EASYOCR_BEAM_WIDTH")
    if beam is not None:
        kw["beamWidth"] = beam

    return kw


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: easyocr_label.py [--lines] IMAGE_PATH [MODEL_DIR]", file=sys.stderr)
        return 2
    args = sys.argv[1:]
    line_mode = True
    if args and args[0] == "--lines":
        args = args[1:]
    elif args and args[0] == "--paragraph":
        line_mode = False
        args = args[1:]
    if not args:
        print("usage: easyocr_label.py [--lines] IMAGE_PATH [MODEL_DIR]", file=sys.stderr)
        return 2
    image_path = args[0]
    model_dir = args[1] if len(args) > 1 else None
    try:
        import easyocr
    except ImportError:
        print("easyocr not installed", file=sys.stderr)
        return 3

    quantize = os.environ.get("EASYOCR_QUANTIZE", "").strip().lower() in ("1", "true", "yes")
    reader = easyocr.Reader(
        ["en"],
        gpu=False,
        model_storage_directory=model_dir or None,
        verbose=False,
        quantize=quantize,
    )

    kw = _readtext_kwargs()
    if line_mode:
        kw["paragraph"] = False
    else:
        kw["paragraph"] = True

    detections = reader.readtext(image_path, **kw)
    if isinstance(detections, str):
        print(detections)
    else:
        for line in detections:
            text = line if isinstance(line, str) else str(line)
            if text.strip():
                print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
