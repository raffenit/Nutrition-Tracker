#!/usr/bin/env python3
"""Run EasyOCR on a label image; print plain text lines to stdout."""
from __future__ import annotations

import sys


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: easyocr_label.py IMAGE_PATH [MODEL_DIR]", file=sys.stderr)
        return 2
    image_path = sys.argv[1]
    model_dir = sys.argv[2] if len(sys.argv) > 2 else None
    try:
        import easyocr
    except ImportError:
        print("easyocr not installed", file=sys.stderr)
        return 3

    reader = easyocr.Reader(["en"], gpu=False, model_storage_directory=model_dir or None, verbose=False)
    lines = reader.readtext(image_path, detail=0, paragraph=True)
    if isinstance(lines, str):
        print(lines)
    else:
        for line in lines:
            text = line if isinstance(line, str) else str(line)
            if text.strip():
                print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
