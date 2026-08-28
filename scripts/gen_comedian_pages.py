#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""Generate crawlable static pages for every performer in performers.txt."""

from __future__ import annotations

import argparse
import html
import json
import re
from pathlib import Path


TRANSLIT = str.maketrans({
    "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d",
    "е": "e", "є": "ie", "ж": "zh", "з": "z", "и": "y", "і": "i",
    "ї": "i", "й": "i", "к": "k", "л": "l", "м": "m", "н": "n",
    "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch",
    "ь": "", "ю": "iu", "я": "ia", "’": "", "'": "",
})


def slugify(name: str) -> str:
    slug = name.lower().translate(TRANSLIT)
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    return slug or "comedian"


def read_performers(path: Path) -> list[str]:
    return [line.split("|", 1)[0].strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def render_page(template: str, name: str, bio: str, url: str) -> str:
    safe_name = html.escape(name, quote=True)
    page = template.replace("<title>Комік • StandupHub</title>", f"<title>{safe_name} — стендап-комік • StandupHub</title>")
    page = page.replace('  <link rel="stylesheet" href="assets/styles.css" />', f'  <link rel="stylesheet" href="assets/styles.css" />\n  <link rel="canonical" href="{url}" />\n  <meta name="description" content="Стендап-відео, біографія та виступи коміка {safe_name} на StandupHub." />')
    page = page.replace('const p = new URLSearchParams(location.search).get("p") || "";', f'const p = new URLSearchParams(location.search).get("p") || {json.dumps(name, ensure_ascii=False)};')
    return page


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--docs", default="docs")
    parser.add_argument("--output", default="generated/comedians")
    parser.add_argument("--base", required=True)
    args = parser.parse_args()

    docs = Path(args.docs)
    template = (docs / "comedian.html").read_text(encoding="utf-8")
    performers = list(dict.fromkeys(read_performers(Path("performers.txt"))))
    bios_path = docs / "comedians_bios.json"
    bios = json.loads(bios_path.read_text(encoding="utf-8")) if bios_path.exists() else {}
    base = args.base.rstrip("/")
    used_slugs: set[str] = set()
    page_map: dict[str, str] = {}

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    legacy_dir = docs / "comedians"
    if legacy_dir.exists():
        for legacy_page in legacy_dir.glob("*.html"):
            legacy_page.unlink()
        try:
            legacy_dir.rmdir()
        except OSError:
            pass

    for old_page in output_dir.glob("*.html"):
        old_page.unlink()

    for name in performers:
        slug = slugify(name)
        original_slug = slug
        suffix = 2
        while slug in used_slugs:
            slug = f"{original_slug}-{suffix}"
            suffix += 1
        used_slugs.add(slug)
        old_page = docs / f"{slug}.html"
        if old_page.exists():
            old_page.unlink()
        url = f"{base}/{slug}.html"
        page_map[name] = slug
        bio_data = bios.get(name, {})
        bio = str(bio_data.get("bio", "")).strip()
        (output_dir / f"{slug}.html").write_text(render_page(template, name, bio, url), encoding="utf-8")

    (docs / "data").mkdir(parents=True, exist_ok=True)
    (docs / "data/performer_pages.json").write_text(
        json.dumps(page_map, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"OK: generated {len(performers)} comedian pages")


if __name__ == "__main__":
    main()