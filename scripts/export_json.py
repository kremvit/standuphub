#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
import re
from pathlib import Path


def _load_performers(path: Path):
    """Return list of (canonical, compiled_regex) from performers.txt."""
    compiled = []
    if not path.exists():
        return compiled
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = [re.sub(r"\s+", " ", p).strip() for p in line.split("|")]
        parts = [p for p in parts if p]
        if not parts:
            continue
        canonical = parts[0]
        seen = set()
        for alias in parts:
            alias = re.sub(r"\s+", " ", alias).strip()
            key = alias.casefold()
            if key in seen:
                continue
            seen.add(key)
            pat = re.compile(
                rf"(?<!\w){re.escape(alias)}(?!\w)", flags=re.IGNORECASE | re.UNICODE
            )
            compiled.append((canonical, pat))
    return compiled


def _match_performers(title: str, compiled) -> set:
    t = re.sub(r"\s+", " ", title).strip()
    matched = set()
    for canonical, rx in compiled:
        if rx.search(t):
            matched.add(canonical)
    return matched

OUT_DIR = Path("out")
WEB_DATA = Path("docs/data")

def read_csv(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))

def to_int(x, default=0):
    try:
        s = str(x).strip().replace(" ", "")
        if s == "":
            return default
        return int(float(s))
    except Exception:
        return default

def to_float(x, default=0.0):
    try:
        s = str(x).strip().replace(" ", "")
        if s == "":
            return default
        return float(s)
    except Exception:
        return default

def main():
    WEB_DATA.mkdir(parents=True, exist_ok=True)

    videos_path = OUT_DIR / "videos_clean.csv"
    rating_path = OUT_DIR / "rating.csv"

    if not videos_path.exists():
        raise SystemExit(f"Missing: {videos_path}")
    if not rating_path.exists():
        raise SystemExit(f"Missing: {rating_path}")

    videos = read_csv(videos_path)
    rating = read_csv(rating_path)

    # Normalize video fields for frontend
    for v in videos:
        v["view_count"] = to_int(v.get("view_count"))
        v["like_count"] = to_int(v.get("like_count"))
        v["duration_sec"] = to_int(v.get("duration_sec"))
        v["duration_min"] = to_float(v.get("duration_min"))
        v["video_id"] = (v.get("video_id") or "").strip()
        v["published_at"] = (v.get("published_at") or "").strip()
        v["performer"] = (v.get("performer") or "").strip()

    # Normalize rating fields for frontend
    for r in rating:
        r["rank"] = to_int(r.get("rank"))
        r["score"] = to_float(r.get("score"))
        r["score_with_engagement"] = to_float(r.get("score_with_engagement"))
        r["eng_mult"] = to_float(r.get("eng_mult"))
        r["total_views"] = to_int(r.get("total_views"))
        r["peak_views"] = to_int(r.get("peak_views"))
        r["video_count"] = to_int(r.get("video_count"))
        r["total_minutes"] = to_float(r.get("total_minutes"))
        r["total_likes"] = to_int(r.get("total_likes"))
        r["like_rate_pct"] = to_float(r.get("like_rate_pct"))
        r["like_rate_smooth_pct"] = to_float(r.get("like_rate_smooth_pct"))
        r["performer"] = (r.get("performer") or "").strip()

    # Read optional year-specific rating CSVs
    rating_by_year = {"all": rating}
    for year in range(2022, 2027):
        path = OUT_DIR / f"rating_{year}.csv"
        if path.exists():
            rating_by_year[str(year)] = read_csv(path)
        else:
            rating_by_year[str(year)] = []

    (WEB_DATA / "videos.json").write_text(json.dumps(videos, ensure_ascii=False), encoding="utf-8")
    (WEB_DATA / "rating.json").write_text(json.dumps(rating, ensure_ascii=False), encoding="utf-8")
    (WEB_DATA / "rating_by_year.json").write_text(json.dumps(rating_by_year, ensure_ascii=False), encoding="utf-8")

    print("OK -> docs/data/videos.json")
    print("OK -> docs/data/rating.json")
    print("OK -> docs/data/rating_by_year.json")

    # Build co-occurrence recommendations from ALL video sources
    compiled_aliases = _load_performers(Path("performers.txt"))
    co: dict = {}

    def _add_cooccurrence(title: str) -> None:
        performers_in_video = list(_match_performers(title, compiled_aliases))
        if len(performers_in_video) < 2:
            return
        for a in performers_in_video:
            for b in performers_in_video:
                if a == b:
                    continue
                co.setdefault(a, {})
                co[a][b] = co[a].get(b, 0) + 1

    # Source 1: standup videos with multiple performers (already matched by rate.py)
    dropped_path = OUT_DIR / "videos_dropped.csv"
    if dropped_path.exists():
        for row in read_csv(dropped_path):
            if row.get("drop_reason") != "multiple_performers_in_title":
                continue
            raw = row.get("matched_performers", "")
            performers_in_video = [p.strip() for p in raw.split(";") if p.strip()]
            if len(performers_in_video) < 2:
                continue
            for a in performers_in_video:
                for b in performers_in_video:
                    if a == b:
                        continue
                    co.setdefault(a, {})
                    co[a][b] = co[a].get(b, 0) + 1

    # Source 2: rejected videos (improvs, podcasts, shows) — scan titles directly
    rejected_path = OUT_DIR / "rejected_videos.csv"
    if rejected_path.exists() and compiled_aliases:
        for row in read_csv(rejected_path):
            _add_cooccurrence(row.get("title", ""))

    # Source 3: filtered standup videos — scan titles directly (catches multi in clean set too)
    filtered_path = OUT_DIR / "filtered_videos.csv"
    if filtered_path.exists() and compiled_aliases:
        for row in read_csv(filtered_path):
            _add_cooccurrence(row.get("title", ""))

    (WEB_DATA / "recommendations.json").write_text(json.dumps(co, ensure_ascii=False), encoding="utf-8")
    print("OK -> docs/data/recommendations.json")

if __name__ == "__main__":
    main()
