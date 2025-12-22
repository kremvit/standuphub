#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
rate.py

Build a stand-up comedian rating from filtered_videos.csv using performers.txt and exceptions.txt.

Filters (before rating):
- drop videos listed in exceptions.txt (by URL or video_id)
- drop videos where title matches 0 performers from performers.txt
- drop videos where title matches >1 performers (multi)

Adds engagement:
- total_likes / total_views (like rate)
- Bayesian-smoothed like rate (stabilized, avoids tiny-sample winners)

Outputs:
- out/rating.csv
- out/videos_clean.csv
- out/videos_dropped.csv
"""

from __future__ import annotations

import csv
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# ---------- Config ----------

INPUT_VIDEOS = Path("out/filtered_videos.csv")
INPUT_PERFORMERS = Path("performers.txt")
INPUT_EXCEPTIONS = Path("exceptions.txt")

OUT_DIR = Path("out")
OUT_RATING = OUT_DIR / "rating.csv"
OUT_CLEAN = OUT_DIR / "videos_clean.csv"
OUT_DROPPED = OUT_DIR / "videos_dropped.csv"

# Composite index weights (industry-ish, creator-centric)
# Score = 0.45*log(total_views) + 0.25*log(peak) + 0.20*log(video_count) + 0.10*log(total_minutes)
W_TOTAL = 0.45   # catalog impact
W_PEAK = 0.25    # hit power
W_COUNT = 0.20   # consistency
W_MINUTES = 0.10 # output volume

# Engagement smoothing:
# like_rate_smooth = (likes + M*p0) / (views + M)
# M is the "confidence" in prior mean p0, expressed in views.
SMOOTH_M_VIEWS = 50_000

# Optional: make engagement gently affect final score (recommended OFF by default)
ENABLE_ENGAGEMENT_MULTIPLIER = False
ENG_MULT_CLAMP = (0.85, 1.15)  # clamp multiplier range


# ---------- Helpers ----------

_YT_ID_RE = re.compile(r"(?:v=|/shorts/|youtu\.be/)([A-Za-z0-9_-]{11})")

def extract_video_id(url_or_id: str) -> Optional[str]:
    s = (url_or_id or "").strip()
    if not s:
        return None
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", s):
        return s
    m = _YT_ID_RE.search(s)
    if m:
        return m.group(1)
    return None

def parse_int(x: object, default: int = 0) -> int:
    try:
        if x is None:
            return default
        s = str(x).strip().replace(" ", "")
        if s == "":
            return default
        return int(float(s))
    except Exception:
        return default

def parse_duration_iso8601(d: str) -> int:
    # ISO8601: PT#H#M#S
    d = (d or "").strip()
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d)
    if not m:
        return 0
    h = int(m.group(1) or 0)
    mm = int(m.group(2) or 0)
    s = int(m.group(3) or 0)
    return h * 3600 + mm * 60 + s

def safe_casefold(s: object) -> str:
    return str(s or "").casefold()

def normalize_spaces(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()

def ensure_out_dir() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)


# ---------- Data structures ----------

@dataclass
class VideoRow:
    video_id: str
    url: str
    title: str
    view_count: int
    like_count: int
    duration_sec: int
    published_at: str
    channel_id: str
    channel_title: str


# ---------- Loaders ----------

def load_exceptions(path: Path) -> Tuple[Set[str], Set[str]]:
    """
    Returns:
      - excluded_video_ids
      - excluded_urls (exact lines from file)
    """
    excluded_ids: Set[str] = set()
    excluded_urls: Set[str] = set()

    if not path.exists():
        return excluded_ids, excluded_urls

    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        excluded_urls.add(line)
        vid = extract_video_id(line)
        if vid:
            excluded_ids.add(vid)

    return excluded_ids, excluded_urls

def load_performers(path: Path) -> Tuple[Dict[str, List[str]], List[Tuple[str, re.Pattern]]]:
    """
    performers.txt format:
      Canonical | alias1 | alias2 | ...

    Returns:
      canonical -> aliases list (including canonical itself)
      compiled list of (canonical, regex) for alias matching
    """
    canonical_to_aliases: Dict[str, List[str]] = {}
    compiled: List[Tuple[str, re.Pattern]] = []

    text = path.read_text(encoding="utf-8").splitlines()
    for raw in text:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        parts = [normalize_spaces(p) for p in line.split("|")]
        parts = [p for p in parts if p]
        if not parts:
            continue

        canonical = parts[0]
        aliases: List[str] = []
        seen: Set[str] = set()

        for a in [canonical] + parts[1:]:
            a = normalize_spaces(a)
            if not a:
                continue
            key = safe_casefold(a)
            if key in seen:
                continue
            seen.add(key)
            aliases.append(a)

        canonical_to_aliases[canonical] = aliases

    # compile alias regex with "word-ish" boundaries
    # (?<!\w)ALIAS(?!\w) works fairly well for UA + LAT.
    for canonical, aliases in canonical_to_aliases.items():
        for alias in aliases:
            a = alias.strip()
            if not a:
                continue
            pat = re.compile(rf"(?<!\w){re.escape(a)}(?!\w)", flags=re.IGNORECASE | re.UNICODE)
            compiled.append((canonical, pat))

    return canonical_to_aliases, compiled

def read_videos_csv(path: Path) -> List[VideoRow]:
    """
    Tries to be flexible with column names.

    Expected (any of these):
      - video_id / id
      - url / video_url
      - title
      - view_count / views / viewCount
      - like_count / likes / likeCount
      - duration_sec / duration_seconds / length_seconds / duration (iso8601 PT..)
      - published_at / published / publishedAt
      - channel_id / channelId
      - channel_title / channelTitle
    """
    rows: List[VideoRow] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            url = (r.get("url") or r.get("video_url") or "").strip()
            vid = (r.get("video_id") or r.get("id") or "").strip()
            if not vid:
                vid = extract_video_id(url) or ""

            if not url and vid:
                url = f"https://www.youtube.com/watch?v={vid}"

            title = (r.get("title") or "").strip()

            views = parse_int(r.get("view_count") or r.get("views") or r.get("viewCount") or r.get("viewcount") or 0, 0)
            likes = parse_int(r.get("like_count") or r.get("likes") or r.get("likeCount") or r.get("likecount") or 0, 0)

            # duration
            dur = r.get("duration_sec") or r.get("duration_seconds") or r.get("length_seconds") or r.get("lengthSeconds")
            duration_sec = parse_int(dur, 0)
            if duration_sec == 0:
                iso = (r.get("duration") or r.get("contentDetails.duration") or "").strip()
                if iso.startswith("PT"):
                    duration_sec = parse_duration_iso8601(iso)

            published_at = (r.get("published_at") or r.get("published") or r.get("publishedAt") or "").strip()
            channel_id = (r.get("channel_id") or r.get("channelId") or "").strip()
            channel_title = (r.get("channel_title") or r.get("channelTitle") or "").strip()

            if not vid:
                continue

            rows.append(
                VideoRow(
                    video_id=vid,
                    url=url,
                    title=title,
                    view_count=views,
                    like_count=likes,
                    duration_sec=duration_sec,
                    published_at=published_at,
                    channel_id=channel_id,
                    channel_title=channel_title,
                )
            )
    return rows


# ---------- Core logic ----------

def match_performers_in_title(title: str, compiled_aliases: List[Tuple[str, re.Pattern]]) -> Set[str]:
    """
    Returns set of canonical performer names matched in title.
    """
    t = normalize_spaces(title)
    matched: Set[str] = set()
    for canonical, rx in compiled_aliases:
        if rx.search(t):
            matched.add(canonical)
    return matched

def compute_base_score(total_views: int, peak_views: int, video_count: int, total_minutes: float) -> float:
    """
    Composite Stand-up Reach Index (SRI), creator-centric.

    Uses log1p normalization to prevent one metric dominating.
    """
    T = math.log1p(max(0, total_views))
    P = math.log1p(max(0, peak_views))
    V = math.log1p(max(0, video_count))
    D = math.log1p(max(0.0, total_minutes))
    return (W_TOTAL * T) + (W_PEAK * P) + (W_COUNT * V) + (W_MINUTES * D)

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def main() -> None:
    ensure_out_dir()

    if not INPUT_VIDEOS.exists():
        raise SystemExit(f"Input not found: {INPUT_VIDEOS}")
    if not INPUT_PERFORMERS.exists():
        raise SystemExit(f"Input not found: {INPUT_PERFORMERS}")

    excluded_ids, excluded_urls = load_exceptions(INPUT_EXCEPTIONS)
    _, compiled_aliases = load_performers(INPUT_PERFORMERS)
    videos = read_videos_csv(INPUT_VIDEOS)

    clean_rows: List[dict] = []
    dropped_rows: List[dict] = []

    # Aggregation per performer
    per_views: Dict[str, List[int]] = {}
    per_minutes: Dict[str, float] = {}
    per_likes: Dict[str, int] = {}

    # Global totals (for engagement prior mean p0)
    global_views = 0
    global_likes = 0

    for v in videos:
        # exceptions (by id or exact url line)
        if v.video_id in excluded_ids or v.url in excluded_urls:
            dropped_rows.append({
                "video_id": v.video_id,
                "url": v.url,
                "title": v.title,
                "view_count": v.view_count,
                "like_count": v.like_count,
                "duration_sec": v.duration_sec,
                "published_at": v.published_at,
                "channel_title": v.channel_title,
                "drop_reason": "exception",
            })
            continue

        matched = match_performers_in_title(v.title, compiled_aliases)

        if len(matched) == 0:
            dropped_rows.append({
                "video_id": v.video_id,
                "url": v.url,
                "title": v.title,
                "view_count": v.view_count,
                "like_count": v.like_count,
                "duration_sec": v.duration_sec,
                "published_at": v.published_at,
                "channel_title": v.channel_title,
                "drop_reason": "no_performer_in_title",
            })
            continue

        if len(matched) > 1:
            dropped_rows.append({
                "video_id": v.video_id,
                "url": v.url,
                "title": v.title,
                "view_count": v.view_count,
                "like_count": v.like_count,
                "duration_sec": v.duration_sec,
                "published_at": v.published_at,
                "channel_title": v.channel_title,
                "drop_reason": "multiple_performers_in_title",
                "matched_performers": "; ".join(sorted(matched)),
            })
            continue

        performer = next(iter(matched))

        clean_rows.append({
            "performer": performer,
            "video_id": v.video_id,
            "url": v.url,
            "title": v.title,
            "view_count": v.view_count,
            "like_count": v.like_count,
            "duration_sec": v.duration_sec,
            "duration_min": round(v.duration_sec / 60.0, 3) if v.duration_sec else 0.0,
            "published_at": v.published_at,
            "channel_id": v.channel_id,
            "channel_title": v.channel_title,
        })

        per_views.setdefault(performer, []).append(v.view_count)
        per_minutes[performer] = per_minutes.get(performer, 0.0) + (v.duration_sec / 60.0 if v.duration_sec else 0.0)
        per_likes[performer] = per_likes.get(performer, 0) + v.like_count

        global_views += v.view_count
        global_likes += v.like_count

    # Global prior mean like-rate
    p0 = (global_likes / global_views) if global_views > 0 else 0.0
    M = SMOOTH_M_VIEWS

    rating_rows: List[dict] = []
    for performer, views_list in per_views.items():
        total_views = sum(views_list)
        peak_views = max(views_list) if views_list else 0
        video_count = len(views_list)
        total_minutes = per_minutes.get(performer, 0.0)
        total_likes = per_likes.get(performer, 0)

        base_score = compute_base_score(total_views, peak_views, video_count, total_minutes)

        like_rate = (total_likes / total_views) if total_views > 0 else 0.0
        like_rate_smooth = ((total_likes + M * p0) / (total_views + M)) if (total_views + M) > 0 else 0.0

        # Optional gentle multiplier (OFF by default)
        eng_mult = 1.0
        score_with_engagement = base_score
        if ENABLE_ENGAGEMENT_MULTIPLIER and p0 > 0:
            # Relative to dataset mean; gentle effect and clamped
            eng_mult = 1.0 + 0.5 * ((like_rate_smooth - p0) / p0)
            eng_mult = clamp(eng_mult, ENG_MULT_CLAMP[0], ENG_MULT_CLAMP[1])
            score_with_engagement = base_score * eng_mult

        rating_rows.append({
            "performer": performer,

            # main scores
            "score": round(base_score, 8),
            "score_with_engagement": round(score_with_engagement, 8),
            "eng_mult": round(eng_mult, 6),

            # core metrics
            "total_views": total_views,
            "peak_views": peak_views,
            "video_count": video_count,
            "total_minutes": round(total_minutes, 3),

            # engagement metrics
            "total_likes": total_likes,
            "like_rate_pct": round(like_rate * 100.0, 4),
            "like_rate_smooth_pct": round(like_rate_smooth * 100.0, 4),
        })

    # Sort: by score_with_engagement if enabled, else by score
    sort_key = "score_with_engagement" if ENABLE_ENGAGEMENT_MULTIPLIER else "score"
    rating_rows.sort(key=lambda r: r[sort_key], reverse=True)

    for i, r in enumerate(rating_rows, start=1):
        r["rank"] = i

    # ---------- Write CSVs ----------

    def write_csv(path: Path, rows: List[dict]) -> None:
        if not rows:
            path.write_text("", encoding="utf-8")
            return
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)

    write_csv(OUT_CLEAN, clean_rows)
    write_csv(OUT_DROPPED, dropped_rows)
    write_csv(OUT_RATING, rating_rows)

    print(f"OK: videos in: {len(videos)}")
    print(f"OK: videos clean (rated): {len(clean_rows)} -> {OUT_CLEAN}")
    print(f"OK: videos dropped: {len(dropped_rows)} -> {OUT_DROPPED}")
    print(f"OK: rating rows: {len(rating_rows)} -> {OUT_RATING}")
    if global_views > 0:
        print(f"OK: global like rate (prior p0): {p0*100:.3f}% (M={M})")
    else:
        print("WARN: global views == 0; engagement prior p0 = 0")


if __name__ == "__main__":
    main()
