#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import re
import time
from html import unescape
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests


RETRY_ATTEMPTS = 3
RETRY_BACKOFF_SEC = 2.0
OUTPUT_PATH = Path("docs/data/events.json")
PERFORMERS_PATH = Path("performers.txt")
SOURCES = [
    ("Karabas", "https://lviv.karabas.com/stand-up/"),
]
UNDERGROUND_URL = "https://www.undergroundstandup.com/"
# Undocumented internal API; the public catalog page returns 403 for bots.
CONCERT_UA_API_URL = "https://concert.ua/api/v3/search"
CONCERT_UA_QUERIES = ["standup", "стендап", "стенд ап"]
# Elasticsearch backend powering Kontramarka's site search widget (used by all city subdomains).
KONTRAMARKA_API_URL = "https://search.mticket.com.ua:9191/api/uk/events/search"
KONTRAMARKA_QUERIES = ["standup", "стендап", "стенд ап"]
KONTRAMARKA_STANDUP_CATEGORY_SUFFIX = "_23"
KONTRAMARKA_MONTHS = {
    "січня": 1, "лютого": 2, "березня": 3, "квітня": 4, "травня": 5, "червня": 6,
    "липня": 7, "серпня": 8, "вересня": 9, "жовтня": 10, "листопада": 11, "грудня": 12,
}
KONTRAMARKA_EVENT_TZ = timezone(timedelta(hours=3))


def load_performers():
    performers = {}
    for raw_line in PERFORMERS_PATH.read_text(encoding="utf-8").splitlines():
        parts = [part.strip() for part in raw_line.split("|") if part.strip()]
        if parts:
            canonical = parts[0]
            explicit_aliases = [part for part in parts if "http" not in part.casefold()]
            performers[canonical] = list(dict.fromkeys(
                explicit_aliases + generate_case_aliases(canonical)
            ))
    return performers


def generate_case_aliases(name):
    words = name.split()
    if len(words) < 2:
        return []

    def variants(word):
        if word.endswith("ія"):
            return [word[:-2] + suffix for suffix in ("ії", "ію", "ією")]
        if word.endswith("а"):
            return [word[:-1] + suffix for suffix in ("и", "у", "ою")]
        if word.endswith("я"):
            return [word[:-1] + suffix for suffix in ("ї", "ю", "єю")]
        if word.endswith("й"):
            return [word[:-1] + suffix for suffix in ("я", "ю", "єм")]
        if word.endswith("ь"):
            return [word[:-1] + suffix for suffix in ("я", "ю", "ем")]
        return [word + suffix for suffix in ("а", "у", "ом", "ем")]

    first, last = words[0], words[-1]
    return [f"{first_variant} {last_variant}" for first_variant in variants(first) for last_variant in variants(last)]


def iter_event_objects(value):
    if isinstance(value, dict):
        event_type = value.get("@type", "")
        types = event_type if isinstance(event_type, list) else [event_type]
        if "Event" in types or (value.get("startDate") and value.get("url")):
            yield value
        for child in value.values():
            yield from iter_event_objects(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_event_objects(child)


def parse_json_ld(html):
    scripts = re.findall(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    for script in scripts:
        try:
            yield from iter_event_objects(json.loads(script.strip()))
        except json.JSONDecodeError:
            continue


def normalize_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()


def contains_alias(text, alias):
    normalized_alias = normalize_text(alias)
    if not normalized_alias:
        return False
    pattern = rf"(?<!\w){re.escape(normalized_alias)}(?!\w)"
    return re.search(pattern, text, flags=re.UNICODE) is not None


def contains_name_variant(text, performer):
    if contains_alias(text, performer):
        return True
    tokens = [token for token in re.findall(r"[^\W\d_]+", normalize_text(performer), flags=re.UNICODE) if len(token) >= 4]
    if len(tokens) < 2:
        return False

    def stem(word):
        for suffix in ("увати", "ювати", "ями", "ами", "ого", "ому", "ою", "ею", "ої", "ій", "ів", "ев", "ем", "ом", "ах", "ях", "а", "и", "і", "у", "ю", "о", "е"):
            if word.endswith(suffix) and len(word) - len(suffix) >= 3:
                return word[:-len(suffix)]
        return word

    performer_stems = [stem(token) for token in tokens]
    text_tokens = re.findall(r"[^\W\d_]+", text, flags=re.UNICODE)
    text_stems = {stem(token) for token in text_tokens}
    return all(token in text_stems for token in performer_stems)


def event_location(event):
    location = event.get("location") or {}
    if isinstance(location, str):
        return location, ""
    address = location.get("address") or {}
    if isinstance(address, str):
        return location.get("name", "") or address, address
    return location.get("name", ""), address.get("addressLocality", "")


def event_image(event):
    image = event.get("image")
    if isinstance(image, list):
        image = image[0] if image else None
    if isinstance(image, dict):
        image = image.get("url")
    return image or ""


def get_with_retry(url, headers, params=None):
    # 403 is treated as a persistent block (bot protection), not retried.
    last_error = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            response = requests.get(url, timeout=30, headers=headers, params=params)
            if response.status_code in (429, 500, 502, 503, 504) and attempt < RETRY_ATTEMPTS:
                delay = RETRY_BACKOFF_SEC * (2 ** (attempt - 1))
                print(f"RETRY {attempt}/{RETRY_ATTEMPTS}: {url}: status={response.status_code}, sleep={delay:.1f}s")
                time.sleep(delay)
                continue
            response.raise_for_status()
            return response
        except requests.RequestException as error:
            last_error = error
            if attempt >= RETRY_ATTEMPTS or (getattr(error.response, "status_code", None) == 403):
                break
            delay = RETRY_BACKOFF_SEC * (2 ** (attempt - 1))
            print(f"RETRY {attempt}/{RETRY_ATTEMPTS}: {url}: {type(error).__name__}, sleep={delay:.1f}s")
            time.sleep(delay)
    raise last_error


def is_future(start):
    try:
        date = datetime.fromisoformat(str(start).replace("Z", "+00:00"))
    except ValueError:
        return False
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    return date >= datetime.now(timezone.utc)


def strip_html(value):
    value = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def fetch_concert_ua_events(headers):
    api_headers = dict(headers)
    api_headers.update({
        "Accept": "application/json",
        "X-Requested-With": "XMLHttpRequest",
    })

    events_by_id = {}
    for query in CONCERT_UA_QUERIES:
        try:
            response = get_with_retry(CONCERT_UA_API_URL, api_headers, params={"query": query})
        except requests.RequestException as error:
            print(f"WARNING: Concert.ua unavailable ({query}): {error}")
            continue
        for item in response.json().get("response", {}).get("items", []):
            if item.get("entityType") == "Event" and item.get("id") is not None:
                events_by_id[item["id"]] = item

    events = []
    for item in events_by_id.values():
        start = str(item.get("dateStart", "")).replace(" ", "T")
        url = urljoin("https://concert.ua", item.get("link") or "")
        title = item.get("title") or ""
        if not url or not start or not title or not is_future(start):
            continue
        venues = item.get("venuesTitles") or []
        cities = item.get("venuesCitiesTitles") or []
        performers_titles = item.get("performersTitles") or []
        events.append({
            "title": title,
            "description": " ".join(performers_titles),
            "start": start,
            "venue": venues[0] if venues else "",
            "city": cities[0] if cities else "",
            "url": url,
            "poster": item.get("posterUrl") or "",
            "source": "Concert.ua",
        })
    return events


def fetch_kontramarka_events(headers):
    api_headers = dict(headers)
    api_headers.update({"Accept": "application/json", "Content-Type": "application/json"})

    events_by_id = {}
    for query in KONTRAMARKA_QUERIES:
        try:
            response = get_with_retry(KONTRAMARKA_API_URL, api_headers, params={"lang": "uk", "query": query})
        except requests.RequestException as error:
            print(f"WARNING: Kontramarka.ua unavailable ({query}): {error}")
            continue
        for item_id, item in response.json().get("data", {}).items():
            categories = item.get("categories") or []
            if any(str(category).endswith(KONTRAMARKA_STANDUP_CATEGORY_SUFFIX) for category in categories):
                events_by_id[item_id] = item

    events = []
    for item in events_by_id.values():
        match = re.search(
            r"\(([^)]*)\)<br>(\d{1,2})\s+([^\s,]+),\s*(\d{1,2}):(\d{2})",
            item.get("name", ""),
        )
        if not match:
            continue
        month = KONTRAMARKA_MONTHS.get(match.group(3).casefold())
        if not month:
            continue
        city, day, hour, minute = match.group(1), int(match.group(2)), int(match.group(4)), int(match.group(5))

        now = datetime.now(KONTRAMARKA_EVENT_TZ)
        start_dt = datetime(now.year, month, day, hour, minute, tzinfo=KONTRAMARKA_EVENT_TZ)
        if start_dt < now - timedelta(hours=6):
            start_dt = start_dt.replace(year=now.year + 1)

        title = item.get("showName") or ""
        url = item.get("url") or ""
        if not url or not title or not is_future(start_dt.isoformat()):
            continue
        events.append({
            "title": title,
            "description": " ".join([title, item.get("siteName", "")]),
            "start": start_dt.isoformat(),
            "venue": item.get("siteName", ""),
            "city": city,
            "url": url,
            "poster": item.get("picture") or "",
            "source": "Kontramarka.ua",
        })
    return events


def parse_underground_events(html, headers):
    links = []
    for href in re.findall(r'href=["\']([^"\']+)["\']', html, flags=re.IGNORECASE):
        url = urljoin(UNDERGROUND_URL, unescape(href))
        if re.search(r"/kiyiv/\d{2}-\d{2}-", url) and url not in links:
            links.append(url)

    events = []
    for url in links:
        match = re.search(r"/kiyiv/(\d{2})-(\d{2})-", url)
        if not match:
            continue
        try:
            detail = get_with_retry(url, headers)
        except requests.RequestException as error:
            print(f"WARNING: Underground event unavailable: {url}: {error}")
            continue

        title_match = re.search(r"<title[^>]*>(.*?)</title>", detail.text, flags=re.IGNORECASE | re.DOTALL)
        title = strip_html(title_match.group(1)) if title_match else "Підпільний стендап"
        text = strip_html(detail.text)
        time_match = re.search(r"\b(\d{1,2}):(\d{2})\b", text)
        if not time_match:
            continue
        start = datetime(
            datetime.now().year,
            int(match.group(1)),
            int(match.group(2)),
            int(time_match.group(1)),
            int(time_match.group(2)),
            tzinfo=timezone(timedelta(hours=3)),
        ).isoformat()
        if not is_future(start):
            continue
        events.append({
            "title": title,
            "description": text,
            "start": start,
            "venue": "Underground Stand Up Club",
            "city": "Київ",
            "url": url,
            "poster": "",
            "source": "Underground Standup",
        })
    return events


def main():
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    performers = load_performers()
    events_by_performer = {name: [] for name in performers}
    seen = set()
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
        ),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "uk-UA,uk;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.google.com/",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
    }

    for source_name, source_url in SOURCES:
        try:
            response = get_with_retry(source_url, headers)
        except requests.RequestException as error:
            print(f"WARNING: {source_name} unavailable: {error}")
            continue

        for event in parse_json_ld(response.text):
            url = urljoin(source_url, str(event.get("url", "")))
            start = event.get("startDate")
            title = event.get("name") or event.get("headline") or ""
            if not url or not start or not title or not is_future(start) or url in seen:
                continue

            location_name, city = event_location(event)
            work = event.get("workPerformed")
            work_name = work.get("name", "") if isinstance(work, dict) else ""
            haystack = normalize_text(" ".join([title, event.get("description", ""), work_name]))
            matched = False
            for performer, aliases in performers.items():
                if not any(contains_name_variant(haystack, alias) for alias in aliases):
                    continue
                events_by_performer[performer].append({
                    "title": title,
                    "start": start,
                    "venue": location_name,
                    "city": city,
                    "url": url,
                    "poster": event_image(event),
                    "source": source_name,
                })
                matched = True
            if matched:
                seen.add(url)

    try:
        underground_response = get_with_retry(UNDERGROUND_URL, headers)
        underground_events = parse_underground_events(underground_response.text, headers)
    except requests.RequestException as error:
        print(f"WARNING: Underground Standup unavailable: {error}")
        underground_events = []

    for event in underground_events + fetch_concert_ua_events(headers) + fetch_kontramarka_events(headers):
        if event["url"] in seen:
            continue
        haystack = normalize_text(" ".join([event["title"], event["description"]]))
        matched = False
        for performer, aliases in performers.items():
            if not any(contains_name_variant(haystack, alias) for alias in aliases):
                continue
            events_by_performer[performer].append({key: value for key, value in event.items() if key != "description"})
            matched = True
        if matched:
            seen.add(event["url"])

    for events in events_by_performer.values():
        events.sort(key=lambda event: event["start"])
        del events[5:]

    OUTPUT_PATH.write_text(
        json.dumps(events_by_performer, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    count = sum(len(events) for events in events_by_performer.values())
    print(f"OK -> {OUTPUT_PATH} ({count} events)")


if __name__ == "__main__":
    main()