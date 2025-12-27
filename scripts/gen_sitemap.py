#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Generate sitemap.xml and robots.txt from built static site (docs/).
- Finds all .html files under docs/
- Converts them to public URLs (index.html -> /, other.html -> /other.html)
- Writes docs/sitemap.xml and docs/robots.txt

Usage:
  python3 scripts/gen_sitemap.py --base https://standuphub.com.ua --docs docs
"""

from __future__ import annotations

import argparse
from pathlib import Path
import xml.etree.ElementTree as ET


DEFAULT_EXCLUDE = {
    # add names you don't want in sitemap:
    # "404.html", "dev.html"
}

def html_to_url(base: str, docs_dir: Path, html_file: Path) -> str:
    rel = html_file.relative_to(docs_dir).as_posix()
    if rel.endswith("index.html"):
        rel = rel[:-len("index.html")]  # "" or "subdir/"
        if rel == "":
            return base + "/"
        return base + "/" + rel
    return base + "/" + rel

def generate_sitemap(base: str, docs_dir: Path) -> str:
    urlset = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")

    html_files = sorted([p for p in docs_dir.rglob("*.html") if p.is_file()])

    for p in html_files:
        if p.name in DEFAULT_EXCLUDE:
            continue
        # Skip files inside hidden dirs just in case
        if any(part.startswith(".") for part in p.relative_to(docs_dir).parts):
            continue

        url_el = ET.SubElement(urlset, "url")
        loc = ET.SubElement(url_el, "loc")
        loc.text = html_to_url(base, docs_dir, p)

    xml_bytes = ET.tostring(urlset, encoding="utf-8", xml_declaration=True)
    return xml_bytes.decode("utf-8")

def generate_robots(base: str) -> str:
    # Minimal, safe robots + sitemap pointer
    return "\n".join([
        "User-agent: *",
        "Allow: /",
        "",
        f"Sitemap: {base}/sitemap.xml",
        "",
    ])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True, help="Site base URL, e.g. https://standuphub.com.ua")
    ap.add_argument("--docs", default="docs", help="Built site folder (default: docs)")
    args = ap.parse_args()

    base = args.base.rstrip("/")
    docs_dir = Path(args.docs)

    if not docs_dir.exists():
        raise SystemExit(f"Docs folder not found: {docs_dir}")

    sitemap_xml = generate_sitemap(base, docs_dir)
    (docs_dir / "sitemap.xml").write_text(sitemap_xml, encoding="utf-8")

    robots_txt = generate_robots(base)
    (docs_dir / "robots.txt").write_text(robots_txt, encoding="utf-8")

    print(f"OK: wrote {docs_dir/'sitemap.xml'} and {docs_dir/'robots.txt'}")

if __name__ == "__main__":
    main()
