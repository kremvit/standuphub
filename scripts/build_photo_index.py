#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
from pathlib import Path


VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def build_photo_index(photo_dir: Path) -> list[dict[str, str]]:
    items = []
    for path in sorted(photo_dir.iterdir(), key=lambda p: p.name.lower()):
        if not path.is_file() or path.suffix.lower() not in VALID_EXTENSIONS:
            continue

        items.append(
            {
                "name": path.stem,
                "file": path.name,
                "path": f"./photo/{path.name}",
            }
        )
    return items


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    photo_dir = repo_root / "docs" / "photo"
    output_path = repo_root / "docs" / "data" / "photo_index.json"

    if not photo_dir.exists():
        raise SystemExit(f"Missing photo directory: {photo_dir}")

    index = build_photo_index(photo_dir)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"==> built {output_path} ({len(index)} photos)")


if __name__ == "__main__":
    main()