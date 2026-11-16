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


def _group_rows(detections: list) -> list[str]:
    """Join word boxes whose vertical spans overlap into left-to-right table rows."""
    boxes = []
    for box, text, _conf in detections:
        if not str(text).strip():
            continue
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        boxes.append((min(ys), max(ys), min(xs), str(text).strip()))
    boxes.sort(key=lambda b: (b[0] + b[1]) / 2)
    rows: list[list] = []
    for top, bottom, left, text in boxes:
        center = (top + bottom) / 2
        row = rows[-1] if rows else None
        if row is not None and row[0] <= center <= row[1]:
            row[2].append((left, text))
        else:
            rows.append([top, bottom, [(left, text)]])
    return [" ".join(t for _x, t in sorted(r[2])) for r in rows]


def _read_banded(reader, image_path: str, kw: dict, bands: list) -> list[str]:
    """Group detections into caller-supplied row bands (fractions of image height).

    Returns exactly len(bands) lines — one per band, empty string when a band has
    no detections — so downstream row alignment matches other OCR engines that
    read the same slices.
    """
    import cv2

    img = cv2.imread(image_path)
    if img is None:
        return [""] * len(bands)
    height = img.shape[0]
    detections = reader.readtext(image_path, **kw)
    grouped: list[list] = [[] for _ in bands]
    for box, text, _conf in detections:
        label = str(text).strip()
        if not label:
            continue
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        center_y = (sum(ys) / len(ys)) / height
        for band_index, (y0, y1) in enumerate(bands):
            if y0 <= center_y < y1:
                grouped[band_index].append((min(xs), label))
                break
    return [" ".join(t for _x, t in sorted(row)) for row in grouped]


def _read_one(reader, image_path: str, mode: str, bands: list | None = None) -> list[str]:
    """Return text lines for one image; mode is lines | rows | paragraph."""
    kw = _readtext_kwargs()
    if mode == "rows":
        kw["detail"] = 1
        kw["paragraph"] = False
        if bands:
            return _read_banded(reader, image_path, kw, bands)
        return _group_rows(reader.readtext(image_path, **kw))
    kw["paragraph"] = mode != "lines"
    detections = reader.readtext(image_path, **kw)
    if isinstance(detections, str):
        return [detections] if detections.strip() else []
    return [str(line) for line in detections if str(line).strip()]


def _run_batch(manifest_path: str, model_dir: str | None) -> int:
    """One Reader for many images; JSONL results on stdout.

    Manifest: [{"file": "path.png", "mode": "lines"|"rows"|"paragraph", "i": original_index,
                "bands": optional [[y0_frac, y1_frac], ...] row bands for rows mode}, ...]
    Emits {"i": n, "text": "..."} per job, or {"i": n, "error": "..."} on failure.
    """
    import json

    with open(manifest_path, "r", encoding="utf-8") as fh:
        jobs = json.load(fh)
    base_dir = os.path.dirname(os.path.abspath(manifest_path))

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

    for position, job in enumerate(jobs):
        image_path = job["file"]
        if not os.path.isabs(image_path):
            image_path = os.path.join(base_dir, image_path)
        mode = job.get("mode", "lines")
        bands = job.get("bands")
        # "i" lets sharded manifests report the caller's original job index.
        index = job.get("i", position)
        try:
            lines = _read_one(reader, image_path, mode, bands)
            print(json.dumps({"i": index, "text": "\n".join(lines)}))
            sys.stdout.flush()
        except Exception as exc:  # keep batch alive; per-image failure is data, not fatal
            print(json.dumps({"i": index, "error": str(exc)}))
            sys.stdout.flush()
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "usage: easyocr_label.py [--lines|--rows|--paragraph] IMAGE_PATH [MODEL_DIR]\n"
            "       easyocr_label.py --batch MANIFEST.json [MODEL_DIR]",
            file=sys.stderr,
        )
        return 2
    args = sys.argv[1:]
    if args and args[0] == "--batch":
        if len(args) < 2:
            print("usage: easyocr_label.py --batch MANIFEST.json [MODEL_DIR]", file=sys.stderr)
            return 2
        return _run_batch(args[1], args[2] if len(args) > 2 else None)

    line_mode = True
    row_mode = False
    if args and args[0] == "--lines":
        args = args[1:]
    elif args and args[0] == "--rows":
        row_mode = True
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

    if row_mode:
        for row in _read_one(reader, image_path, "rows"):
            print(row)
        return 0

    for text in _read_one(reader, image_path, "paragraph" if not line_mode else "lines"):
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
