# -*- coding: utf-8 -*-

import json
import os
import re
import time
import argparse
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()


# ============================================================
# НАЛАШТУВАННЯ
# ============================================================

INPUT_FILE = Path("performers.txt")
OUTPUT_FILE = Path("docs/comedians_bios.json")

MODEL = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")

REQUEST_DELAY_SECONDS = 3
MAX_RETRIES = 4

MIN_BIO_LENGTH = 140
MAX_BIO_LENGTH = 750


# ============================================================
# ЧИТАННЯ comedians.txt
# ============================================================

def parse_comedian_line(line: str) -> dict[str, Any] | None:
    """
    Підтримує рядки:

    Віктор Перунський
    Віктор Перунський | Перунський
    Віктор Перунський | Перунський | https://instagram.com/...
    Віталік Кремінь | Кремінь | Віталій Кремінь |
    https://instagram.com/kremvit/
    """

    line = line.strip()

    if not line or line.startswith("#"):
        return None

    # Прибираємо нумерацію:
    # 1. Ім'я
    # 1) Ім'я
    # 1 - Ім'я
    line = re.sub(
        r"^\s*\d+\s*[\.\)\-]\s*",
        "",
        line,
    ).strip()

    parts = [
        part.strip()
        for part in line.split("|")
        if part.strip()
    ]

    if not parts:
        return None

    name = parts[0]
    aliases: list[str] = []
    instagram = ""

    for part in parts[1:]:
        if "instagram.com" in part.casefold():
            instagram = part
        else:
            aliases.append(part)

    return {
        "name": name,
        "aliases": aliases,
        "instagram": instagram,
        "original_line": line,
    }


def load_comedians() -> list[dict[str, Any]]:
    if not INPUT_FILE.exists():
        raise FileNotFoundError(
            f"Не знайдено файл: {INPUT_FILE.resolve()}"
        )

    lines = INPUT_FILE.read_text(
        encoding="utf-8-sig"
    ).splitlines()

    comedians: list[dict[str, Any]] = []
    seen_names: set[str] = set()

    for line in lines:
        comedian = parse_comedian_line(line)

        if not comedian:
            continue

        normalized_name = comedian["name"].casefold()

        if normalized_name in seen_names:
            print(
                f"Дублікат пропущено: {comedian['name']}"
            )
            continue

        seen_names.add(normalized_name)
        comedians.append(comedian)

    return comedians


# ============================================================
# РОБОТА З JSON
# ============================================================

def migrate_old_results(
    results: dict[str, Any],
) -> dict[str, Any]:
    """
    Перетворює старі ключі на кшталт:

    "Віктор Перунський | Перунський | https://..."

    на:

    "Віктор Перунський"
    """

    migrated: dict[str, Any] = {}

    for old_key, value in results.items():
        parsed = parse_comedian_line(old_key)

        if parsed:
            name = parsed["name"]
        else:
            name = old_key.strip()

        if not isinstance(value, dict):
            value = {
                "bio": str(value),
            }

        value.setdefault("name", name)

        if parsed:
            value.setdefault(
                "aliases",
                parsed.get("aliases", []),
            )
            value.setdefault(
                "instagram",
                parsed.get("instagram", ""),
            )

        # Якщо вже існує нормальний запис, не замінюємо його
        # старим порожнім записом.
        existing = migrated.get(name)

        if existing:
            existing_bio = str(
                existing.get("bio", "")
            ).strip()

            new_bio = str(
                value.get("bio", "")
            ).strip()

            if existing_bio and not new_bio:
                continue

        migrated[name] = value

    return migrated


def load_existing_results() -> dict[str, Any]:
    if not OUTPUT_FILE.exists():
        return {}

    try:
        results = json.loads(
            OUTPUT_FILE.read_text(encoding="utf-8")
        )
    except json.JSONDecodeError as error:
        raise RuntimeError(
            f"Некоректний JSON у файлі "
            f"{OUTPUT_FILE}: {error}"
        ) from error

    if not isinstance(results, dict):
        raise RuntimeError(
            f"{OUTPUT_FILE} повинен містити JSON-об'єкт."
        )

    return migrate_old_results(results)


def save_results(results: dict[str, Any]) -> None:
    temporary_file = OUTPUT_FILE.with_suffix(".tmp")

    temporary_file.write_text(
        json.dumps(
            results,
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    temporary_file.replace(OUTPUT_FILE)


# ============================================================
# ОЧИЩЕННЯ ТА ПЕРЕВІРКА БІОГРАФІЇ
# ============================================================

def clean_bio(text: str) -> str:
    text = text.strip()

    # Прибираємо Markdown-блоки.
    text = re.sub(
        r"^```(?:text|markdown|json)?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )

    text = re.sub(
        r"\s*```$",
        "",
        text,
    )

    # Прибираємо заголовки та маркери.
    text = re.sub(
        r"^\s*#+\s*",
        "",
        text,
    )

    text = re.sub(
        r"^\s*[-*•]\s*",
        "",
        text,
    )

    # Прибираємо нумерацію на початку відповіді.
    text = re.sub(
        r"^\s*\d+[\.\)]\s*",
        "",
        text,
    )

    # Прибираємо лапки навколо всього тексту.
    text = text.strip("\"'“”«»")

    # Об'єднуємо рядки в один абзац.
    text = re.sub(
        r"\s+",
        " ",
        text,
    ).strip()

    # Прибираємо службові заголовки.
    text = re.sub(
        (
            r"^(коротка біографія|біографія|"
            r"опис коміка|опис)\s*:\s*"
        ),
        "",
        text,
        flags=re.IGNORECASE,
    )

    # Прибираємо службові маркери посилань:
    # [1], [1.1], [1.1.2], [2, 3]
    text = re.sub(
        (
            r"\[\s*\d+(?:\.\d+)*"
            r"(?:\s*,\s*\d+(?:\.\d+)*)*\s*\]"
        ),
        "",
        text,
    )

    # Прибираємо конструкції типу:
    # [1.1.2, 1.3.4
    # якщо модель обірвала маркер.
    text = re.sub(
        r"\[\s*\d+(?:\.\d+)*(?:\s*,[^]]*)?$",
        "",
        text,
    )

    # Прибираємо зайві пробіли перед пунктуацією.
    text = re.sub(
        r"\s+([,.!?;:])",
        r"\1",
        text,
    )

    text = re.sub(
        r"\s{2,}",
        " ",
        text,
    ).strip()

    return text


def is_valid_bio(
    bio: str,
    name: str,
) -> tuple[bool, str]:
    if not bio:
        return False, "порожня відповідь"

    if len(bio) < MIN_BIO_LENGTH:
        return (
            False,
            f"занадто короткий текст: "
            f"{len(bio)} символів",
        )

    if len(bio) > MAX_BIO_LENGTH:
        return (
            False,
            f"занадто довгий текст: "
            f"{len(bio)} символів",
        )

    suspicious_fragments = [
        "characters)",
        "символів)",
        "2–4 речення",
        "3–5 речень",
        "поверни лише",
        "без markdown",
        "вимоги:",
        "правила:",
        "один короткий абзац",
        "один суцільний абзац",
        "орієнтовний обсяг",
    ]

    lowered_bio = bio.casefold()

    for fragment in suspicious_fragments:
        if fragment.casefold() in lowered_bio:
            return (
                False,
                "відповідь містить частину "
                f"інструкції: {fragment}",
            )

    # Біографія повинна завершуватися реченням.
    if bio[-1] not in ".!?…»”":
        return (
            False,
            "текст, імовірно, обрізаний: "
            "немає завершального знака",
        )

    word_count = len(bio.split())

    if word_count < 20:
        return (
            False,
            f"замало слів: {word_count}",
        )

    # Перевіряємо наявність першого імені.
    first_name = name.split()[0].casefold()

    if first_name not in lowered_bio:
        return (
            False,
            f"у тексті не знайдено ім'я «{name}»",
        )

    return True, ""


# ============================================================
# ОБРОБКА ВІДПОВІДІ GEMINI
# ============================================================

def get_finish_reason(response: Any) -> str:
    try:
        candidates = response.candidates or []

        if not candidates:
            return "UNKNOWN"

        finish_reason = candidates[0].finish_reason

        return str(finish_reason or "UNKNOWN")

    except (
        AttributeError,
        IndexError,
        TypeError,
    ):
        return "UNKNOWN"


def extract_sources(
    response: Any,
) -> list[dict[str, str]]:
    sources: list[dict[str, str]] = []

    try:
        candidates = response.candidates or []

        if not candidates:
            return sources

        metadata = candidates[0].grounding_metadata

        if not metadata:
            return sources

        chunks = metadata.grounding_chunks or []

        for chunk in chunks:
            web = getattr(chunk, "web", None)

            if not web:
                continue

            title = (
                getattr(web, "title", "") or ""
            ).strip()

            url = (
                getattr(web, "uri", "") or ""
            ).strip()

            if not url:
                continue

            source = {
                "title": title,
                "url": url,
            }

            if source not in sources:
                sources.append(source)

    except (
        AttributeError,
        IndexError,
        TypeError,
    ):
        pass

    return sources


def build_identity(
    comedian: dict[str, Any],
) -> str:
    lines = [
        f"Основне ім'я: {comedian['name']}"
    ]

    aliases = comedian.get("aliases", [])

    if aliases:
        lines.append(
            "Інші варіанти імені або псевдоніми: "
            + ", ".join(aliases)
        )

    instagram = comedian.get("instagram", "")

    if instagram:
        lines.append(
            f"Instagram для ідентифікації: {instagram}"
        )

    return "\n".join(lines)


def build_prompt(
    comedian: dict[str, Any],
) -> str:
    name = comedian["name"]
    identity = build_identity(comedian)

    return f"""
Ти редактор українського сайту StandupHub.

Знайди через Google Search достовірну публічну інформацію
про цього українського стендап-коміка або комікесу:

{identity}

Створи один завершений інформаційний абзац українською мовою.

Абзац повинен:
- починатися з імені «{name}»;
- містити 3 або 4 повні речення;
- мати орієнтовно від 250 до 500 символів;
- коротко пояснювати, чим людина відома;
- згадувати підтверджені комедійні проєкти, виступи,
  творчий стиль або іншу доречну професійну діяльність.

Використовуй лише факти, підтверджені результатами пошуку.
Не вигадуй дату народження, освіту, рідне місто, сімейний
стан чи рік початку кар'єри.

Не додавай заголовок, нумерацію, список, Markdown,
примітки, посилання або позначення джерел у тексті.
Не повторюй інструкції.

Поверни виключно готовий завершений абзац.
""".strip()


def generate_bio(
    client: genai.Client,
    comedian: dict[str, Any],
) -> dict[str, Any]:
    name = comedian["name"]
    prompt = build_prompt(comedian)

    config = types.GenerateContentConfig(
        tools=[
            types.Tool(
                google_search=types.GoogleSearch()
            )
        ],

        # Цього достатньо для пошуку та короткого абзацу.
        max_output_tokens=4096,

        # Мінімальне мислення для короткої редакторської задачі.
        thinking_config=types.ThinkingConfig(
            thinking_level="minimal"
        ),
    )

    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=config,
    )

    raw_text = response.text or ""
    bio = clean_bio(raw_text)
    finish_reason = get_finish_reason(response)

    valid, validation_error = is_valid_bio(
        bio=bio,
        name=name,
    )

    if not valid:
        raise RuntimeError(
            f"{validation_error}. "
            f"Finish reason: {finish_reason}. "
            f"Відповідь: {bio!r}"
        )

    return {
        "name": name,
        "aliases": comedian.get("aliases", []),
        "instagram": comedian.get("instagram", ""),
        "bio": bio,
        "sources": extract_sources(response),
        "model": MODEL,
        "verified": False,
        "finish_reason": finish_reason,
    }


# ============================================================
# ВИЗНАЧЕННЯ, ЧИ ПОТРІБНА ПОВТОРНА ГЕНЕРАЦІЯ
# ============================================================

def result_needs_regeneration(
    existing: Any,
    name: str,
) -> bool:
    if not isinstance(existing, dict):
        return True

    bio = clean_bio(
        str(existing.get("bio", ""))
    )

    valid, _ = is_valid_bio(
        bio=bio,
        name=name,
    )

    return not valid


# ============================================================
# ОБРОБКА ПОМИЛОК
# ============================================================

def is_balance_error(error_text: str) -> bool:
    lowered = error_text.casefold()

    return (
        "prepayment credits are depleted" in lowered
        or "credits are depleted" in lowered
    )


def is_rate_limit_error(error_text: str) -> bool:
    lowered = error_text.casefold()

    return (
        "429" in lowered
        or "resource_exhausted" in lowered
        or "rate limit" in lowered
    )


def is_connection_error(error_text: str) -> bool:
    lowered = error_text.casefold()

    return (
        "winerror 10054" in lowered
        or "connection reset" in lowered
        or "connection was forcibly closed" in lowered
        or "connecterror" in lowered
    )


# ============================================================
# MAIN
# ============================================================

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--missing-only",
        action="store_true",
        help="Generate biographies only for comedians absent from the JSON file.",
    )
    args = parser.parse_args()

    api_key = os.getenv("GEMINI_API_KEY")

    if not api_key:
        raise RuntimeError(
            "Не встановлена змінна середовища "
            "GEMINI_API_KEY.\n\n"
            "PowerShell:\n"
            '$env:GEMINI_API_KEY="ТВІЙ_КЛЮЧ"'
        )

    comedians = load_comedians()
    results = load_existing_results()

    # Одразу зберігаємо міграцію старих ключів.
    save_results(results)

    client = genai.Client(
        api_key=api_key,
    )

    total = len(comedians)

    print(f"Знайдено коміків: {total}")
    print(f"Записів у JSON: {len(results)}")
    print(f"Модель: {MODEL}")
    print()

    success_count = 0
    skipped_count = 0
    failed_count = 0

    for index, comedian in enumerate(
        comedians,
        start=1,
    ):
        name = comedian["name"]
        existing = results.get(name)

        has_bio = isinstance(existing, dict) and bool(
            clean_bio(str(existing.get("bio", "")))
        )

        if existing and (
            (args.missing_only and has_bio)
            or (
                not args.missing_only
                and not result_needs_regeneration(
                    existing=existing,
                    name=name,
                )
            )
        ):
            print(
                f"[{index}/{total}] "
                f"Пропущено: {name}"
            )

            skipped_count += 1
            continue

        if existing:
            print(
                f"[{index}/{total}] "
                f"Повторна генерація: {name}"
            )
        else:
            print(
                f"[{index}/{total}] "
                f"Обробка: {name}"
            )

        last_error: Exception | None = None
        generated = False

        for attempt in range(
            1,
            MAX_RETRIES + 1,
        ):
            try:
                result = generate_bio(
                    client=client,
                    comedian=comedian,
                )

                results[name] = result
                save_results(results)

                print(f"  ✓ {result['bio']}")
                print(
                    f"  Джерел: "
                    f"{len(result['sources'])}"
                )

                success_count += 1
                generated = True
                break

            except Exception as error:
                last_error = error
                error_text = str(error)

                print(
                    f"  Помилка, спроба "
                    f"{attempt}/{MAX_RETRIES}: "
                    f"{error_text}"
                )

                # Баланс закінчився — далі запускати
                # запити немає сенсу.
                if is_balance_error(error_text):
                    print()
                    print(
                        "Баланс Gemini API вичерпано."
                    )
                    print(
                        "Усі вже створені біографії "
                        "збережено."
                    )
                    print(
                        f"Файл: {OUTPUT_FILE.resolve()}"
                    )
                    return

                if attempt >= MAX_RETRIES:
                    break

                if is_rate_limit_error(error_text):
                    wait_seconds = 60 * attempt

                elif is_connection_error(error_text):
                    wait_seconds = 15 * attempt

                else:
                    wait_seconds = 10 * attempt

                print(
                    f"  Очікування "
                    f"{wait_seconds} секунд..."
                )

                time.sleep(wait_seconds)

        if not generated:
            results[name] = {
                "name": name,
                "aliases": comedian.get(
                    "aliases",
                    [],
                ),
                "instagram": comedian.get(
                    "instagram",
                    "",
                ),
                "bio": "",
                "sources": [],
                "model": MODEL,
                "verified": False,
                "error": str(last_error),
            }

            save_results(results)

            print("  ✗ Не вдалося створити опис.")
            failed_count += 1

        time.sleep(REQUEST_DELAY_SECONDS)

    print()
    print("Готово.")
    print(f"Створено: {success_count}")
    print(f"Пропущено готових: {skipped_count}")
    print(f"Помилок: {failed_count}")
    print(f"Файл: {OUTPUT_FILE.resolve()}")


if __name__ == "__main__":
    main()