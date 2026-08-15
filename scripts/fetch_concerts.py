#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import re
from html import unescape
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests


OUTPUT_PATH = Path("docs/data/events.json")
PERFORMERS_PATH = Path("performers.txt")
SOURCES = [
    ("Concert.ua", "https://concert.ua/uk/catalog/all-cities/humor"),
    ("Karabas", "https://lviv.karabas.com/stand-up/"),
    ("Kontramarka.ua", "https://lviv.kontramarka.ua/uk/standUp"),
]
UNDERGROUND_URL = "https://www.undergroundstandup.com/"


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
            detail = requests.get(url, timeout=30, headers=headers)
            detail.raise_for_status()
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
            "source": "Underground Standup",
        })
    return events


def main():
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    performers = load_performers()
    events_by_performer = {name: [] for name in performers}
    seen = set()
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; StandupHub/1.0)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "uk-UA,uk;q=0.9",
    }

    for source_name, source_url in SOURCES:
        try:
            response = requests.get(source_url, timeout=30, headers=headers)
            response.raise_for_status()
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
                    "source": source_name,
                })
                matched = True
            if matched:
                seen.add(url)

    try:
        underground_response = requests.get(UNDERGROUND_URL, timeout=30, headers=headers)
        underground_response.raise_for_status()
        underground_events = parse_underground_events(underground_response.text, headers)
    except requests.RequestException as error:
        print(f"WARNING: Underground Standup unavailable: {error}")
        underground_events = []

    for event in underground_events:
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