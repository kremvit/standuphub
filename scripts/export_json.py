#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import csv
import json
from pathlib import Path

OUT_DIR = Path("out")
WEB_DATA = Path("docs/data")

def read_csv(path: Path):
    with path.open("r", encoding="utf-8", newline="") as f:
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

    (WEB_DATA / "videos.json").write_text(json.dumps(videos, ensure_ascii=False), encoding="utf-8")
    (WEB_DATA / "rating.json").write_text(json.dumps(rating, ensure_ascii=False), encoding="utf-8")

    print("OK -> docs/data/videos.json")
    print("OK -> docs/data/rating.json")

if __name__ == "__main__":
    main()
