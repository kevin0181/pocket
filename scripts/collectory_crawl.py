#!/usr/bin/env python3
"""
Collectory public page crawler for TCG Lens KR.

Default behavior:
  - Crawls Collectory set pages from your local PC.
  - Saves cards into local SQLite.
  - If SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set, upserts to Supabase too.

Use slowly. This intentionally avoids concurrent requests.
"""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable


BASE_URL = "https://www.collectory.cc"
ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "collectory.sqlite"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0 Safari/537.36"


@dataclass
class SetInfo:
    collectory_id: str
    name: str
    code: str | None
    region: str
    image_url: str | None
    url: str
    raw: dict


@dataclass
class CardInfo:
    collectory_id: str
    name: str
    number: str | None
    rarity: str | None
    region: str
    set_id: str | None
    set_name: str | None
    set_code: str | None
    image_url: str | None
    collectory_url: str
    current_price: int | None
    price_status: str | None
    search_text: str
    raw: dict


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Crawl Collectory public Pokemon card data into SQLite/Supabase.")
    parser.add_argument("--region", default="kr", choices=["kr", "jp", "us", "cn", "all"], help="Collectory region to crawl.")
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite DB path.")
    parser.add_argument("--limit-sets", type=int, default=0, help="Stop after N sets. 0 means no limit.")
    parser.add_argument("--limit-cards", type=int, default=0, help="Stop after N cards total. 0 means no limit.")
    parser.add_argument("--set-query", default="", help="Only crawl sets whose name/code contains this text.")
    parser.add_argument("--set-id", default="", help="Crawl one Collectory set id directly.")
    parser.add_argument("--set-name", default="", help="Display name to use with --set-id.")
    parser.add_argument("--set-code", default="", help="Set code to use with --set-id.")
    parser.add_argument("--list-sets", action="store_true", help="Print matching sets and exit without crawling cards.")
    parser.add_argument("--sleep", type=float, default=1.2, help="Seconds to wait between HTTP requests.")
    parser.add_argument("--dry-run", action="store_true", help="Parse and print without writing DB.")
    parser.add_argument("--supabase", action="store_true", help="Also upsert parsed cards to Supabase.")
    args = parser.parse_args()

    db_path = Path(args.db)
    conn = None if args.dry_run else open_db(db_path)
    regions = ["kr", "jp", "us", "cn"] if args.region == "all" else [args.region]
    all_cards: list[CardInfo] = []

    try:
        for region in regions:
            sets = [make_direct_set(args.set_id, region, args.set_name, args.set_code)] if args.set_id else fetch_sets(region)
            if args.set_query and not args.set_id:
                sets = filter_sets(sets, args.set_query)
            if args.limit_sets:
                sets = sets[: args.limit_sets]
            print(f"[sets] region={region} count={len(sets)}")

            if args.list_sets:
                for set_info in sets:
                    print(f"  {set_info.name} {set_info.code or ''} {set_info.collectory_id}")
                continue

            for index, set_info in enumerate(sets, start=1):
                print(f"[set {index}/{len(sets)}] {set_info.name} {set_info.code or ''} {set_info.collectory_id}")
                time.sleep(args.sleep)
                cards = fetch_cards_for_set(set_info)
                print(f"  cards={len(cards)}")

                if args.limit_cards:
                    remaining = args.limit_cards - len(all_cards)
                    if remaining <= 0:
                        break
                    cards = cards[:remaining]

                all_cards.extend(cards)
                if conn:
                    upsert_sqlite(conn, cards)
                if args.supabase and cards:
                    upsert_supabase(cards)

                if args.limit_cards and len(all_cards) >= args.limit_cards:
                    break
    finally:
        if conn:
            conn.close()

    print(f"[done] cards={len(all_cards)}")
    if args.dry_run:
        print(json.dumps([asdict(card) for card in all_cards[:5]], ensure_ascii=False, indent=2))


def filter_sets(sets: list[SetInfo], query: str) -> list[SetInfo]:
    compact_query = normalize_search_text(query)
    return [
        set_info
        for set_info in sets
        if compact_query in normalize_search_text(" ".join([set_info.name, set_info.code or "", set_info.collectory_id]))
    ]


def make_direct_set(set_id: str, region: str, name: str, code: str) -> SetInfo:
    query = "" if region == "kr" else f"?region={region}"
    return SetInfo(
        collectory_id=set_id,
        name=name or set_id,
        code=code or None,
        region=region,
        image_url=None,
        url=f"{BASE_URL}/sets/{set_id}{query}",
        raw={"id": set_id, "name_ko": name or None, "set_code_ko": code or None},
    )


def fetch_sets(region: str) -> list[SetInfo]:
    url = f"{BASE_URL}/sets?region={urllib.parse.quote(region)}"
    text = fetch_text(url)
    decoded = decode_next_text(text)
    records = extract_escaped_objects(decoded, required_key="set_code_")
    sets: list[SetInfo] = []
    seen: set[str] = set()

    for record in records:
        collectory_id = str(record.get("id") or "")
        if not collectory_id or collectory_id in seen:
            continue
        seen.add(collectory_id)

        name = first_text(record, ["name_ko", "name", "name_ja", "name_en"])
        code = first_text(record, [f"set_code_{region}", "set_code_ko", "set_code_ja", "set_code_en", "set_code_cn"])
        if not name:
            continue

        query = "" if region == "kr" else f"?region={region}"
        sets.append(
            SetInfo(
                collectory_id=collectory_id,
                name=name,
                code=code,
                region=region,
                image_url=first_text(record, ["image_url"]),
                url=f"{BASE_URL}/sets/{collectory_id}{query}",
                raw=record,
            )
        )

    return sets


def fetch_cards_for_set(set_info: SetInfo) -> list[CardInfo]:
    text = fetch_text(set_info.url)
    decoded = html.unescape(text)
    blocks = re.finditer(r'(<a class="group[\s\S]*?href="/cards/([0-9a-f-]{36})"[\s\S]*?</a>)', decoded)
    cards: list[CardInfo] = []
    seen: set[str] = set()

    for block_match in blocks:
        block = block_match.group(1)
        card_id = block_match.group(2)
        if card_id in seen:
            continue
        seen.add(card_id)
        card = parse_card_block(card_id, block, set_info)
        if card:
            cards.append(card)

    return cards


def parse_card_block(card_id: str, block: str, set_info: SetInfo) -> CardInfo | None:
    name = clean(match_first(block, [r'<p class="text-sm font-medium truncate flex-1 min-w-0" title="([^"]+)"', r'<img\b[^>]*\balt="([^"]+)"']))
    image_url = clean(match_first(block, [r'<img\b[^>]*\bsrc="([^"]+)"']))
    number = clean(match_first(block, [r'<span class="block text-xs text-muted-foreground truncate">([^<]+)</span>']))
    price_text = clean(match_first(block, [r'<span class="font-semibold text-primary">([^<]+)</span>', r'<span class="text-muted-foreground">([^<]+)</span>']))
    rarity = infer_rarity(block, image_url)
    current_price = parse_price(price_text)
    price_status = "priced" if current_price else ("no_price" if "시세 없음" in price_text else None)

    if not name:
        return None

    search_text = " ".join(
        part
        for part in [name, number, rarity, set_info.name, set_info.code, "한글판" if set_info.region == "kr" else set_info.region]
        if part
    )
    raw = {"price_text": price_text, "set": set_info.raw}

    return CardInfo(
        collectory_id=card_id,
        name=name,
        number=number or None,
        rarity=rarity or None,
        region=set_info.region,
        set_id=set_info.collectory_id,
        set_name=set_info.name,
        set_code=set_info.code,
        image_url=image_url or None,
        collectory_url=f"https://collectory.cc/cards/{card_id}",
        current_price=current_price,
        price_status=price_status,
        search_text=search_text,
        raw=raw,
    )


def open_db(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.execute("pragma journal_mode = wal")
    conn.execute(
        """
        create table if not exists cards (
          collectory_id text primary key,
          name text not null,
          number text,
          rarity text,
          region text,
          set_id text,
          set_name text,
          set_code text,
          image_url text,
          collectory_url text,
          current_price integer,
          price_status text,
          search_text text,
          raw_json text,
          last_seen_at text not null
        )
        """
    )
    conn.execute(
        """
        create table if not exists price_snapshots (
          id integer primary key autoincrement,
          card_id text not null,
          source text not null,
          price integer,
          captured_at text not null,
          raw_json text
        )
        """
    )
    return conn


def upsert_sqlite(conn: sqlite3.Connection, cards: Iterable[CardInfo]) -> None:
    now = now_iso()
    rows = list(cards)
    conn.executemany(
        """
        insert into cards (
          collectory_id, name, number, rarity, region, set_id, set_name, set_code,
          image_url, collectory_url, current_price, price_status, search_text, raw_json, last_seen_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(collectory_id) do update set
          name=excluded.name,
          number=excluded.number,
          rarity=excluded.rarity,
          region=excluded.region,
          set_id=excluded.set_id,
          set_name=excluded.set_name,
          set_code=excluded.set_code,
          image_url=excluded.image_url,
          collectory_url=excluded.collectory_url,
          current_price=excluded.current_price,
          price_status=excluded.price_status,
          search_text=excluded.search_text,
          raw_json=excluded.raw_json,
          last_seen_at=excluded.last_seen_at
        """,
        [
            (
                card.collectory_id,
                card.name,
                card.number,
                card.rarity,
                card.region,
                card.set_id,
                card.set_name,
                card.set_code,
                card.image_url,
                card.collectory_url,
                card.current_price,
                card.price_status,
                card.search_text,
                json.dumps(card.raw, ensure_ascii=False),
                now,
            )
            for card in rows
        ],
    )
    conn.executemany(
        "insert into price_snapshots (card_id, source, price, captured_at, raw_json) values (?, ?, ?, ?, ?)",
        [
            (card.collectory_id, "collectory", card.current_price, now, json.dumps(card.raw, ensure_ascii=False))
            for card in rows
            if card.current_price
        ],
    )
    conn.commit()


def upsert_supabase(cards: list[CardInfo]) -> None:
    supabase_url = normalize_supabase_url(os.environ.get("SUPABASE_URL", ""))
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not supabase_url or not supabase_key:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --supabase")

    now = now_iso()
    payload = [
        {
            "collectory_id": card.collectory_id,
            "name": card.name,
            "number": card.number,
            "rarity": card.rarity,
            "region": card.region,
            "set_id": card.set_id,
            "set_name": card.set_name,
            "set_code": card.set_code,
            "image_url": card.image_url,
            "collectory_url": card.collectory_url,
            "current_price": card.current_price,
            "price_status": card.price_status,
            "search_text": card.search_text,
            "raw": card.raw,
            "last_seen_at": now,
            "updated_at": now,
        }
        for card in cards
    ]
    postgrest_request(
        f"{supabase_url}/rest/v1/cards?on_conflict=collectory_id",
        supabase_key,
        payload,
        extra_headers={"Prefer": "resolution=merge-duplicates"},
    )

    snapshots = [
        {"card_id": card.collectory_id, "source": "collectory", "price": card.current_price, "captured_at": now, "raw": card.raw}
        for card in cards
        if card.current_price
    ]
    if snapshots:
        postgrest_request(f"{supabase_url}/rest/v1/price_snapshots", supabase_key, snapshots)


def postgrest_request(url: str, key: str, payload: list[dict], extra_headers: dict[str, str] | None = None) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            if response.status >= 300:
                raise RuntimeError(f"Supabase write failed: {response.status}")
    except urllib.error.HTTPError as error:
        error_body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(
            f"Supabase write failed: HTTP {error.code} {error.reason}\n"
            f"URL: {url}\n"
            f"Response: {error_body}"
        ) from error
    except urllib.error.URLError as error:
        parsed = urllib.parse.urlparse(url)
        raise RuntimeError(
            "Supabase connection failed.\n"
            f"Host: {parsed.netloc}\n"
            f"URL: {url}\n"
            f"Reason: {error.reason}\n"
            "Check SUPABASE_URL spelling and DNS/network connectivity."
        ) from error


def normalize_supabase_url(value: str) -> str:
    normalized = value.strip().strip('"').strip("'").rstrip("/")
    if normalized.endswith("/rest/v1"):
        normalized = normalized[: -len("/rest/v1")]
    return normalized


def fetch_text(url: str, retries: int = 3) -> str:
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7"}
    for attempt in range(1, retries + 1):
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=40) as response:
                return response.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as error:
            if attempt == retries:
                raise RuntimeError(f"HTTP {error.code} for {url}") from error
        except urllib.error.URLError as error:
            if attempt == retries:
                raise RuntimeError(f"Request failed for {url}: {error}") from error
        time.sleep(1.5 * attempt)
    raise RuntimeError(f"Request failed for {url}")


def extract_escaped_objects(text: str, required_key: str) -> list[dict]:
    objects: list[dict] = []
    pattern = re.compile(r'\{\\"id\\":\\"([0-9a-f-]{36})\\"')
    for match in pattern.finditer(text):
        start = match.start()
        depth = 0
        end = None
        i = start
        while i < len(text):
            char = text[i]
            if char == "{":
                depth += 1
                i += 1
                continue
            if char == "}":
                depth -= 1
                i += 1
                if depth == 0:
                    end = i
                    break
                continue
            i += 1
        if end is None:
            continue
        raw = text[start:end]
        if required_key not in raw:
            continue
        try:
            json_text = raw.replace('\\"', '"').replace("\\/", "/")
            objects.append(json.loads(json_text))
        except json.JSONDecodeError:
            continue
    return objects


def decode_next_text(value: str) -> str:
    return html.unescape(value)


def first_text(record: dict, keys: list[str]) -> str | None:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def match_first(text: str, patterns: list[str]) -> str:
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return match.group(1)
    return ""


def infer_rarity(block: str, image_url: str) -> str | None:
    image_match = re.search(r"\d+_\d+([A-Z]+)\.webp", image_url, re.I)
    if image_match:
        return image_match.group(1).upper()
    badges = re.findall(r'<span data-slot="badge"[\s\S]*?>([^<]+)</span>', block)
    for badge in badges:
        cleaned = clean(badge)
        if re.fullmatch(r"[A-Z]{1,4}", cleaned, re.I):
            return cleaned.upper()
    return None


def parse_price(value: str) -> int | None:
    digits = re.sub(r"\D", "", value)
    if not digits:
        return None
    parsed = int(digits)
    return parsed if parsed > 0 else None


def clean(value: str | None) -> str:
    if not value:
        return ""
    value = html.unescape(value)
    value = re.sub(r"<!--[\s\S]*?-->", "", value)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def normalize_search_text(value: str) -> str:
    return re.sub(r"\s+", "", value).lower()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


if __name__ == "__main__":
    main()
