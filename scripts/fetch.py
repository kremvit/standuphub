import os
import re
import csv
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Callable

import requests
from dateutil.parser import isoparse
from tqdm import tqdm


# =========================
# CONFIG
# =========================

API_KEY = os.getenv("YT_API_KEY")
BASE_URL = "https://www.googleapis.com/youtube/v3"

CUTOFF_DATE = datetime(2022, 2, 24, tzinfo=timezone.utc)

MIN_SEC = 4 * 60          # > 4 minutes
MAX_SEC = 2 * 60 * 60     # < 2 hours (120 minutes)

RE_TITLE_PODCAST = re.compile(r"(подкаст|підкаст|podcast)", re.IGNORECASE)
RE_TITLE_IMPROV = re.compile(r"(імпровізаці\w*|improv\w*)", re.IGNORECASE)
RE_TITLE_ROZGONY = re.compile(r"(розгони\w*|загони\w*)", re.IGNORECASE)
RE_TITLE_HVYLYNA = re.compile(r"(хвилина\w*|уваги\w*)", re.IGNORECASE)

BANNED_TITLE_PHRASES = [
    "я знаю де ти живеш",
    "МЕДИЧНІ ІСТОРІЇ",
    "КРАУД-ВОРК",
    "ВЛОГ",
]

OUTPUT_DIR = "out"
OUT_CSV = os.path.join(OUTPUT_DIR, "filtered_videos.csv")
OUT_DEBUG_JSON = os.path.join(OUTPUT_DIR, "filtered_videos_debug.json")
OUT_REJECTED_CSV = os.path.join(OUTPUT_DIR, "rejected_videos.csv")


# =========================
# MODELS
# =========================

@dataclass
class Video:
    video_id: str
    url: str
    channel_id: str
    channel_title: str

    title: str
    published_at: datetime

    duration_sec: int

    view_count: Optional[int]
    like_count: Optional[int]
    comment_count: Optional[int]


# =========================
# YT API HELPERS
# =========================

def yt_get(endpoint: str, params: Dict[str, Any]) -> Dict[str, Any]:
    if not API_KEY:
        raise RuntimeError("Set YT_API_KEY environment variable first.")
    params = dict(params)
    params["key"] = API_KEY
    r = requests.get(f"{BASE_URL}/{endpoint}", params=params, timeout=30)
    if r.status_code >= 400:
        print("YT ERROR", r.status_code, r.url)
        print(r.text[:2000])  # <- головне: причина тут
    r.raise_for_status()
    return r.json()


def parse_duration(d: str) -> int:
    # ISO8601: PT#H#M#S
    m = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", d)
    if not m:
        return 0
    h = int(m.group(1) or 0)
    mm = int(m.group(2) or 0)
    s = int(m.group(3) or 0)
    return h * 3600 + mm * 60 + s


def resolve_channel_id(identifier: str) -> str:
    identifier = identifier.strip()

    # Channel ID
    if identifier.startswith("UC"):
        return identifier

    # Handle
    if identifier.startswith("@"):
        data = yt_get("channels", {
            "part": "id",
            "forHandle": identifier[1:],
            "maxResults": 1,
        })
        items = data.get("items", [])
        if not items:
            raise RuntimeError(f"Cannot resolve handle via forHandle: {identifier}")
        return items[0]["id"]

    raise ValueError(f"Unknown channel identifier: {identifier}")


def get_uploads_playlist(channel_id: str) -> Tuple[str, str]:
    data = yt_get("channels", {
        "part": "contentDetails,snippet",
        "id": channel_id,
        "maxResults": 1,
    })
    items = data.get("items", [])
    if not items:
        raise RuntimeError(f"Channel not found: {channel_id}")
    item = items[0]
    uploads = item["contentDetails"]["relatedPlaylists"]["uploads"]
    title = item["snippet"]["title"]
    return uploads, title


def get_all_video_ids_from_uploads(playlist_id: str) -> List[str]:
    ids: List[str] = []
    token: Optional[str] = None

    while True:
        params: Dict[str, Any] = {
            "part": "contentDetails",
            "playlistId": playlist_id,
            "maxResults": 50,
        }
        if token:
            params["pageToken"] = token

        data = yt_get("playlistItems", params)
        for it in data.get("items", []):
            vid = it.get("contentDetails", {}).get("videoId")
            if vid:
                ids.append(vid)

        token = data.get("nextPageToken")
        if not token:
            break
        time.sleep(0.05)

    return ids


def get_videos_full(video_ids: List[str]) -> List[Video]:
    videos: List[Video] = []
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i+50]
        data = yt_get("videos", {
            "part": "snippet,contentDetails,statistics",
            "id": ",".join(batch),
            "maxResults": 50,
        })

        for it in data.get("items", []):
            sn = it["snippet"]
            cd = it["contentDetails"]
            st = it.get("statistics", {})

            dur_sec = parse_duration(cd.get("duration", ""))
            published = isoparse(sn["publishedAt"])

            def to_int(x: Any) -> Optional[int]:
                try:
                    if x is None:
                        return None
                    return int(x)
                except Exception:
                    return None

            videos.append(Video(
                video_id=it["id"],
                url=f"https://www.youtube.com/watch?v={it['id']}",
                channel_id=sn["channelId"],
                channel_title=sn.get("channelTitle", ""),

                title=sn.get("title", ""),
                published_at=published,

                duration_sec=dur_sec,

                view_count=to_int(st.get("viewCount")),
                like_count=to_int(st.get("likeCount")),
                comment_count=to_int(st.get("commentCount")),
            ))

        time.sleep(0.05)

    return videos


def load_channel_exceptions(path="channel_exceptions.txt"):
    exceptions = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                channel_id, flag = [x.strip() for x in line.split("|", 1)]
                exceptions.setdefault(channel_id, set()).add(flag)
    except FileNotFoundError:
        pass
    return exceptions


# =========================
# RULE ENGINE
# =========================

Rule = Callable[[Video], Tuple[bool, str]]  # (passed, reason_if_failed)

STANDUP_KEYWORDS = ["стендап", "stand up", "standup"]

CHANNEL_EXCEPTIONS = load_channel_exceptions()

def rule_after_cutoff(v: Video) -> Tuple[bool, str]:
    return (True, "") if v.published_at >= CUTOFF_DATE else (False, "before_2022_02_24")

def rule_min_duration(v: Video) -> Tuple[bool, str]:
    return (True, "") if v.duration_sec > MIN_SEC else (False, f"too_short_<=_{MIN_SEC}s")

def rule_max_duration(v: Video) -> Tuple[bool, str]:
    return (True, "") if v.duration_sec < MAX_SEC else (False, f"too_long_>=_{MAX_SEC}s")

def rule_title_has_standup(v: Video) -> Tuple[bool, str]:
    channel_id = getattr(v, "channel_id", None)
    if (
        channel_id
        and channel_id in CHANNEL_EXCEPTIONS
        and "allow_without_standup_keyword" in CHANNEL_EXCEPTIONS[channel_id]
    ):
        return True, "channel_exception:standup_keyword"

    title = (v.title or "").casefold()
    for kw in STANDUP_KEYWORDS:
        if kw in title:
            return True, ""
    return False, "no_standup_keyword"

def rule_title_not_podcast(v: Video) -> Tuple[bool, str]:
    return (False, "title_has_podcast") if RE_TITLE_PODCAST.search(v.title or "") else (True, "")

def rule_title_not_improv(v: Video) -> Tuple[bool, str]:
    return (False, "title_has_improv") if RE_TITLE_IMPROV.search(v.title or "") else (True, "")

def rule_title_not_rozgony(v: Video) -> Tuple[bool, str]:
    return (False, "title_has_rozgony") if RE_TITLE_ROZGONY.search(v.title or "") else (True, "")

def rule_title_not_hvylyna(v: Video) -> Tuple[bool, str]:
    return (False, "title_has_hvylyna") if RE_TITLE_HVYLYNA.search(v.title or "") else (True, "")

def rule_no_banned_phrases(v: Video) -> Tuple[bool, str]:
    title_cf = (v.title or "").casefold()
    for phrase in BANNED_TITLE_PHRASES:
        if phrase.casefold() in title_cf:
            return False, f"banned_phrase:{phrase}"
    return True, ""

RULES: List[Rule] = [
    rule_after_cutoff,
    rule_min_duration,
    rule_max_duration,
    rule_title_has_standup,
    rule_title_not_podcast,
    rule_title_not_improv,
    rule_title_not_rozgony,
    rule_title_not_hvylyna,
    rule_no_banned_phrases,
]

def apply_rules(v: Video, rules: List[Rule]) -> Tuple[bool, List[str]]:
    for r in rules:
        ok, reason = r(v)
        if not ok:
            return False, [reason]
    return True, []


# =========================
# EXPORT
# =========================

def export_csv(path: str, items: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fields = [
        "published_at","channel_title","channel_id","title",
        "duration_sec","duration_min","view_count","like_count",
        "comment_count","url","video_id",
    ]
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(items)

def export_rejected_csv(path: str, items: List[Dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fields = [
        "published_at","channel_title","channel_id","title",
        "duration_sec","duration_min","view_count","like_count",
        "comment_count","url","video_id","reject_reason",
    ]
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(items)


# =========================
# MAIN
# =========================

def main() -> None:
    with open("channels.txt", encoding="utf-8") as f:
        channel_inputs = [l.strip() for l in f if l.strip() and not l.strip().startswith("#")]

    accepted_rows: List[Dict[str, Any]] = []
    rejected_rows: List[Dict[str, Any]] = []

    for ch in channel_inputs:
        cid = resolve_channel_id(ch)
        uploads_id, channel_name = get_uploads_playlist(cid)

        video_ids = get_all_video_ids_from_uploads(uploads_id)
        videos = get_videos_full(video_ids)

        for v in tqdm(videos, desc=f"Filter: {channel_name}"):
            ok, reasons = apply_rules(v, RULES)

            row = {
                "published_at": v.published_at.isoformat(),
                "channel_title": v.channel_title,
                "channel_id": v.channel_id,
                "title": v.title,
                "duration_sec": v.duration_sec,
                "duration_min": round(v.duration_sec / 60.0, 2),
                "view_count": v.view_count if v.view_count is not None else "",
                "like_count": v.like_count if v.like_count is not None else "",
                "comment_count": v.comment_count if v.comment_count is not None else "",
                "url": v.url,
                "video_id": v.video_id,
            }

            if ok:
                accepted_rows.append(row)
            else:
                rej = dict(row)
                rej["reject_reason"] = ";".join(reasons)
                rejected_rows.append(rej)

    accepted_rows.sort(key=lambda x: x["published_at"], reverse=True)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    export_csv(OUT_CSV, accepted_rows)
    export_rejected_csv(OUT_REJECTED_CSV, rejected_rows)

    with open(OUT_DEBUG_JSON, "w", encoding="utf-8") as f:
        json.dump({
            "criteria_order": [
                "published_at >= 2022-02-24",
                "duration > 4 min",
                "duration < 100 min",
                "title contains standup/стендап",
                "title does NOT contain podcast/подкаст",
                "title does NOT contain improv/імпровізація",
                "title does NOT contain rozgony/zaгони",
                "title does NOT contain hvylyna/uvahy",
                "title does NOT contain banned phrases",
            ],
            "counts": {"accepted": len(accepted_rows), "rejected": len(rejected_rows)},
            "rejected_sample": rejected_rows[:200],
        }, f, ensure_ascii=False, indent=2)

    print("✅ Done")
    print(f"Accepted CSV: {OUT_CSV}")
    print(f"Debug JSON:   {OUT_DEBUG_JSON}")
    print(f"Rejected CSV: {OUT_REJECTED_CSV}")
    print(f"Accepted: {len(accepted_rows)}  Rejected: {len(rejected_rows)}")

if __name__ == "__main__":
    main()
