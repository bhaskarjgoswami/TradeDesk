"""Market news headlines and this week's economic calendar from free public feeds.

Pure stdlib so the local journal (app.py) and the hosted API share one copy:
backend/app/journal/news.py is a byte-for-byte copy (tests check they match).
Read-only: fetches public RSS/JSON, sends no user data anywhere.
"""
from __future__ import annotations

import html
import json
import os
import tempfile
import re
import threading
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

# One place to swap a dead feed. Each feed fails on its own; the rest still load.
# FEEDS[topic][country] -> sources. "*" is the default used for any country without its own list.
COUNTRIES = ("global", "in", "us", "gb", "eu", "ca", "au", "sg", "cn", "asia", "ae", "za")
_CNBC = "https://www.cnbc.com/id/{}/device/rss/rss.html"
_ET = "https://economictimes.indiatimes.com"
FEEDS = {
    "stocks": {
        "*": [("CNBC", _CNBC.format(15839069)), ("Investing.com", "https://www.investing.com/rss/news_25.rss"),
              ("CNBC", _CNBC.format(10000664))],
        "in": [("Economic Times", _ET + "/markets/rssfeeds/1977021501.cms"), ("Mint", "https://www.livemint.com/rss/markets"),
               ("Business Standard", "https://www.business-standard.com/rss/markets-106.rss")],
        "us": [("CNBC", _CNBC.format(15839069)), ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
               ("Investing.com", "https://www.investing.com/rss/news_25.rss")],
        "eu": [("CNBC Europe", _CNBC.format(19794221)), ("France 24", "https://www.france24.com/en/business/rss"),
               ("Investing.com", "https://www.investing.com/rss/news_25.rss")],
        "asia": [("CNBC Asia", _CNBC.format(19832390)), ("Investing.com", "https://www.investing.com/rss/news_25.rss")],
        "gb": [("BBC", "https://feeds.bbci.co.uk/news/business/rss.xml"), ("The Guardian", "https://www.theguardian.com/uk/business/rss")],
        "ca": [("CBC", "https://www.cbc.ca/webfeed/rss/rss-business"), ("CNBC", _CNBC.format(15839069))],
        "au": [("Sydney Morning Herald", "https://www.smh.com.au/rss/business.xml"), ("ABC", "https://www.abc.net.au/news/feed/51892/rss.xml")],
        "sg": [("Business Times", "https://www.businesstimes.com.sg/rss/top-stories"),
               ("CNA", "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936")],
        "cn": [("SCMP", "https://www.scmp.com/rss/92/feed"), ("CNBC Asia", _CNBC.format(19832390))],
        "ae": [("Arabian Business", "https://www.arabianbusiness.com/feed"),
               ("The National", "https://www.thenationalnews.com/arc/outboundfeeds/rss/category/business/?outputType=xml")],
        "za": [("Moneyweb", "https://www.moneyweb.co.za/feed/"), ("CNBC", _CNBC.format(10000664))],
    },
    "crypto": {
        "*": [("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss"), ("Cointelegraph", "https://cointelegraph.com/rss"),
              ("Decrypt", "https://decrypt.co/feed")],
    },
    "forex": {
        "*": [("FXStreet", "https://www.fxstreet.com/rss/news"), ("Investing.com", "https://www.investing.com/rss/news_1.rss")],
        "in": [("FXStreet", "https://www.fxstreet.com/rss/news"), ("Economic Times", _ET + "/markets/forex/rssfeeds/1150221130.cms"),
               ("Investing.com", "https://www.investing.com/rss/news_1.rss")],
    },
    "commodities": {
        "*": [("Investing.com", "https://www.investing.com/rss/news_11.rss"),
              ("Business Standard", "https://www.business-standard.com/rss/markets/commodities-10608.rss")],
    },
    "macro": {
        "*": [("investingLive", "https://investinglive.com/feed/news"), ("Investing.com", "https://www.investing.com/rss/news_14.rss"),
              ("CNBC", _CNBC.format(20910258))],
        "in": [("Economic Times", _ET + "/markets/bonds/rssfeeds/2146846.cms"), ("Mint", "https://www.livemint.com/rss/economy"),
               ("Investing.com", "https://www.investing.com/rss/news_14.rss")],
    },
    "ipo": {
        "*": [("Nasdaq", "https://www.nasdaq.com/feed/rssoutbound?category=IPOs")],
        "in": [("Economic Times", _ET + "/markets/ipos/fpos/rssfeeds/14655708.cms")],
    },
    "funds": {
        "*": [("Nasdaq", "https://www.nasdaq.com/feed/rssoutbound?category=ETFs")],
        "in": [("Economic Times", _ET + "/mf/rssfeeds/359241701.cms"), ("Mint", "https://www.livemint.com/rss/money")],
    },
}


def sources(topic: str, country: str) -> list:
    table = FEEDS[topic]
    return table.get(country) or table["*"]


CALENDAR_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
HEADLINE_TTL = 300
CALENDAR_TTL = 1800
PER_SOURCE = 15
MAX_ITEMS = 300
MAX_BYTES = 3_000_000
TIMEOUT = 6
USER_AGENT = "Mozilla/5.0 (compatible; TradeDesk-News/1.0)"

RETRY_AFTER = 120

_cache: dict = {}
_failed: dict = {}
_lock = threading.Lock()
_tag = re.compile(r"<[^>]+>")
_space = re.compile(r"\s+")


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = resp.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError("feed too large")
    return data


def _cached(key: str, ttl: int, load):
    """Fresh value if cached within ttl, else reload; on failure serve the last good value.
    After a failure the source is left alone for RETRY_AFTER seconds (feeds rate-limit)."""
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        failed_at = _failed.get(key, 0)
    if hit and now - hit[0] < ttl:
        return hit[1]
    if now - failed_at < RETRY_AFTER:
        if hit:
            return hit[1]
        raise RuntimeError("source temporarily unavailable")
    try:
        value = load()
    except Exception:
        with _lock:
            _failed[key] = now
        if hit:
            return hit[1]
        raise
    with _lock:
        _cache[key] = (now, value)
        _failed.pop(key, None)
    return value


def _clean(text: str | None, limit: int) -> str:
    text = html.unescape(_tag.sub(" ", html.unescape(text or "")))
    text = _space.sub(" ", text).strip()
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _when(raw: str | None) -> str | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    dt = None
    try:
        dt = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError):
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:  # e.g. Investing.com "2026-11-16 08:18:25" is UTC
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child(node, *names):
    for child in node:
        if _local(child.tag) in names:
            if _local(child.tag) == "link" and child.get("href"):
                return child.get("href")
            if child.text and child.text.strip():
                return child.text
    return None


# ---------- market impact ----------
# A simple, explainable score: market-moving themes add points, noise subtracts.
# HIGH_IMPACT is the cut-off for "this can move the whole market today".
HIGH_IMPACT = 3
_IMPACT_RULES = [(re.compile(p, re.I), w) for p, w in [
    # central banks and rates
    (r"\b(fomc|federal reserve|the fed|fed (chair|chairman|officials?|minutes|decision|rate)|powell|warsh|ecb|lagarde|bank of england|\bboe\b|bank of japan|\bboj\b|\brbi\b|reserve bank|pboc|snb|rba|rbnz)\b", 3),
    (r"\b(rate (cut|hike|decision)s?|cuts? rates|hikes? rates|interest rates?|monetary policy|policy meeting|repo rate|yields? (jump|surge|spike|soar|plunge))\b", 3),
    # macro data
    (r"\b(cpi|inflation|nonfarm|non-farm|payrolls|jobs report|unemployment rate|gdp|pce|ppi|pmi|retail sales|recession|stagflation)\b", 3),
    # geopolitics and policy shocks
    (r"\b(war|invasion|missile|airstrikes?|ceasefire|sanctions?|tariffs?|trade war|trade deal|embargo|government shutdown|debt ceiling|default|summit|election results?)\b", 3),
    # big market moves
    (r"\b(crash(es|ed)?|plunges?|plummets?|tumbles?|slumps?|sell-?off|rout|meltdown|circuit breaker|trading halt|soars?|skyrockets?|record (high|low)|all-time high|biggest (drop|fall|gain|rally)|bear market|correction)\b", 2),
    (r"\b(sensex|nifty|s&p 500|nasdaq|dow jones|the dow|stoxx|nikkei|hang seng|bitcoin|btc|ether(eum)?|gold|crude|oil|dollar|rupee|yen|treasur(y|ies))\b", 1),
    # crypto shocks
    (r"\b(hack(ed)?|exploit(ed)?|liquidations?|etf (approval|approved|rejected|inflows?|outflows?)|\bsec\b|stablecoin|crypto (ban|bill|rules|regulation))\b", 2),
    # mega-cap earnings and big corporate shocks
    (r"\b(nvidia|apple|microsoft|alphabet|google|amazon|meta|tesla|reliance|hdfc bank|tcs|infosys)\b.*\b(earnings|results|guidance|revenue)\b", 2),
    (r"\b(bankruptcy|bankrupt|collapse[sd]?|bailout|fraud|probe|downgrade)\b", 2),
    # noise
    (r"\b(live updates?|live blog|share price live|stocks? to (buy|watch)|should you buy|which (stock|fund)|top \d+|\d+ stocks|price (prediction|forecast)|opinion|q&a|explained|how to|what to know|petition|podcast|week ahead|weekly recap)\b", -3),
    (r"\bshares? (gain|jump|rise|fall|drop|surge|slump)s? \d+(\.\d+)?%", -2),
]]


def impact_score(title: str, summary: str = "") -> int:
    """Rough market impact of a headline (title counts fully, the summary adds at most 1)."""
    title_score = sum(w for rx, w in _IMPACT_RULES if rx.search(title))
    summary_bonus = 1 if summary and any(w >= 3 and rx.search(summary) for rx, w in _IMPACT_RULES) else 0
    return title_score + summary_bonus


def parse_feed(data: bytes, source: str, cat: str) -> list[dict]:
    """RSS 2.0 or Atom -> [{title, link, source, cat, published_at, summary}]."""
    root = ET.fromstring(data)
    nodes = [n for n in root.iter() if _local(n.tag) in ("item", "entry")]
    out = []
    for node in nodes:
        title = _clean(_child(node, "title"), 220)
        link = (_child(node, "link") or _child(node, "guid") or "").strip()
        if not title or not re.match(r"^https?://", link):
            continue
        out.append({
            "title": title,
            "link": link,
            "source": source,
            "cat": cat,
            "published_at": _when(_child(node, "pubDate", "published", "updated", "date")),
            "summary": _clean(_child(node, "description", "summary", "content"), 280),
        })
        out[-1]["impact"] = impact_score(title, out[-1]["summary"])
        if len(out) >= PER_SOURCE:
            break
    return out


def _feed(cat: str, source: str, url: str) -> list[dict]:
    return _cached("feed:" + cat + ":" + url, HEADLINE_TTL, lambda: parse_feed(_get(url), source, cat))


def _collect(jobs) -> tuple[list, list]:
    items, failed = [], []
    with ThreadPoolExecutor(max_workers=min(12, len(jobs))) as pool:
        futures = [(s, pool.submit(_feed, c, s, u)) for c, s, u in jobs]
        for source, future in futures:
            try:
                items.extend(future.result())
            except Exception:
                if source not in failed:
                    failed.append(source)
    return items, failed


def headlines(cat: str = "all", country: str = "global") -> dict:
    """Headlines for "all" topics, one topic, or a comma-separated list ("stocks,crypto"),
    using the sources for the reader's chosen country."""
    cats = tuple(FEEDS) if cat in ("", "all", None) else tuple(dict.fromkeys(c.strip() for c in cat.split(",")))
    if not cats or any(c not in FEEDS for c in cats):
        raise ValueError("Unknown news category")
    if country not in COUNTRIES:
        raise ValueError("Unknown news country")
    items, failed = _collect([(c, s, u) for c in cats for s, u in sources(c, country)])
    links, titles, unique = set(), set(), []
    for item in items:
        title = item["title"].lower()
        if item["link"] in links or title in titles:
            continue
        links.add(item["link"])
        titles.add(title)
        unique.append(item)
    unique.sort(key=lambda i: i["published_at"] or "", reverse=True)
    return {"items": unique[:MAX_ITEMS], "failed": failed,
            "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}


def warm_all() -> None:
    """Fetch every feed for every topic and country into the cache."""
    jobs = {(c, s, u) for c, table in FEEDS.items() for lst in table.values() for s, u in lst}
    _collect(sorted(jobs))


def parse_calendar(data: bytes) -> list[dict]:
    out = []
    for row in json.loads(data):
        when = _when(row.get("date"))
        impact = str(row.get("impact") or "").lower()
        if not when or impact not in ("high", "medium", "low", "holiday"):
            continue
        out.append({
            "title": _clean(row.get("title"), 140),
            "currency": _clean(row.get("country"), 8).upper(),
            "at": when,
            "impact": impact,
            "forecast": _clean(row.get("forecast"), 24),
            "previous": _clean(row.get("previous"), 24),
        })
    out.sort(key=lambda e: e["at"])
    return out


# ---------- index news ----------
# Headlines about the main indices of the reader's region, from a Google News search
# (the publisher feeds above rarely carry enough index stories). Links open the original article.
INDEX_NEWS = {
    "global": ('"S&P 500" OR Nasdaq OR "FTSE 100" OR Nikkei OR "Hang Seng" OR Sensex', "en-US", "US"),
    "in": ('Nifty OR Sensex OR "Bank Nifty"', "en-IN", "IN"),
    "us": ('"S&P 500" OR Nasdaq OR "Dow Jones"', "en-US", "US"),
    "gb": ('"FTSE 100" OR "FTSE 250"', "en-GB", "GB"),
    "eu": ('"Euro Stoxx" OR DAX OR "CAC 40" OR "FTSE MIB"', "en-GB", "GB"),
    "ca": ('TSX OR "Toronto stocks" OR "Canadian stocks"', "en-CA", "CA"),
    "au": ('"ASX 200" OR "All Ordinaries" OR "NZX 50"', "en-AU", "AU"),
    "sg": ('"Straits Times Index" OR "STI index"', "en-SG", "SG"),
    "cn": ('"Hang Seng" OR "Shanghai Composite" OR "CSI 300"', "en-US", "US"),
    "asia": ('Nikkei OR KOSPI OR "Hang Seng" OR Taiex', "en-US", "US"),
    "ae": ('Tadawul OR "DFM index" OR "ADX index"', "en-AE", "AE"),
    "za": ('JSE OR "Johannesburg Stock Exchange" OR "South African stocks"', "en-ZA", "ZA"),
}
_NIKKEI = r"nikkei 225|nikkei (index|average|stock|share|closes|ends|opens|rises|falls|gains|drops|slides|jumps|hits|tumbles|rallies|sinks)"
# A headline must name the region's index or market to count (search results are broad).
INDEX_TOPIC = {k: re.compile(v, re.I) for k, v in {
    "in": r"nifty|sensex|\bbse\b|\bnse\b|dalal street|indian (stock|share|equity) market",
    "us": r"s&p|nasdaq|\bdow\b|wall street|russell 2000|us stocks|stock market",
    "gb": r"ftse|london (stocks|shares|market)|uk (stocks|shares)",
    "eu": r"stoxx|\bdax\b|cac 40|ftse mib|ibex|european (stocks|shares|markets)",
    "ca": r"\btsx\b|toronto stock|canadian (stocks|shares)",
    "au": r"\basx\b|all ordinaries|\bnzx\b|australian (stocks|shares)",
    "sg": r"\bsti\b|straits times index|singapore (stocks|shares)",
    "cn": r"hang seng|shanghai|shenzhen|csi 300|(china|chinese|hong kong) (stocks|shares)",
    "asia": _NIKKEI + r"|kospi|taiex|hang seng|asian (stocks|shares|markets)",
    "ae": r"tadawul|\bdfm\b|\badx\b|(saudi|gulf|dubai|abu dhabi) (stocks|shares|markets|bourse)",
    "za": r"\bjse\b|top 40|johannesburg|south african (stocks|shares|markets)",
    "global": _NIKKEI + r"|s&p 500|nasdaq|\bdow\b|wall street|ftse|stoxx|\bdax\b|hang seng|sensex|nifty|global (stocks|markets)",
}.items()}
INDEX_NEWS_URL = "https://news.google.com/rss/search?q={q}&hl={hl}&gl={gl}&ceid={gl}:en"
_TICKER_NOISE = re.compile(r"\b[A-Z]{2,}:\s?[A-Z0-9.]+\b|\([A-Z0-9]+\.[A-Z]{1,3}\)|\bseasonal(ity)?\b", re.I)  # "TADAWUL:4040"-style single-stock pages


def parse_index_news(data: bytes) -> list[dict]:
    root = ET.fromstring(data)
    out = []
    for node in root.iter("item"):
        source = _clean(node.findtext("source"), 60)
        title = _clean(node.findtext("title"), 260)
        if source and title.endswith(" - " + source):
            title = title[: -len(source) - 3].rstrip()
        link = (node.findtext("link") or "").strip()
        if not title or not re.match(r"^https?://", link) or _TICKER_NOISE.search(title):
            continue
        out.append({"title": title[:220], "link": link, "source": source or "Google News", "cat": "indices",
                    "published_at": _when(node.findtext("pubDate")), "summary": "",
                    "impact": impact_score(title)})
    return out


def index_news(country: str = "global") -> dict:
    if country not in INDEX_NEWS:
        raise ValueError("Unknown news country")
    query, hl, gl = INDEX_NEWS[country]
    url = INDEX_NEWS_URL.format(q=urllib.parse.quote(query + " when:3d"), hl=hl, gl=gl)
    items = _cached("idxnews:" + country, HEADLINE_TTL, lambda: parse_index_news(_get(url)))
    topic, seen, unique = INDEX_TOPIC[country], set(), []
    for item in sorted(items, key=lambda i: i["published_at"] or "", reverse=True):
        key = item["title"].lower()
        # skip stock-picking and other noise (negative impact score, e.g. "3 stocks to buy")
        if key not in seen and topic.search(item["title"]) and item["impact"] >= 0:
            seen.add(key)
            unique.append(item)
    return {"items": unique[:40]}


# The calendar source rate-limits hard, and servers restart often (deploys, dev reloads).
# Keep the last good copy on disk so a restart reuses it instead of fetching again.
CALENDAR_FILE = os.path.join(tempfile.gettempdir(), "tradedesk-news-calendar.json")


def _load_calendar() -> list[dict]:
    try:
        if time.time() - os.path.getmtime(CALENDAR_FILE) < CALENDAR_TTL:
            with open(CALENDAR_FILE, encoding="utf-8") as handle:
                saved = json.load(handle)
            if isinstance(saved, list):
                return saved
    except (OSError, ValueError):
        pass
    events = parse_calendar(_get(CALENDAR_URL))
    try:
        tmp = CALENDAR_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(events, handle)
        os.replace(tmp, CALENDAR_FILE)
    except OSError:
        pass
    return events


def calendar(impact: str = "medium") -> dict:
    levels = {"high": ("high",), "medium": ("high", "medium"), "all": ("high", "medium", "low", "holiday")}
    if impact not in levels:
        raise ValueError("Unknown impact filter")
    events = _cached("calendar", CALENDAR_TTL, _load_calendar)
    return {"events": [e for e in events if e["impact"] in levels[impact]]}


_warmer_started = False


def start_warmer(interval: int = HEADLINE_TTL - 30) -> None:
    """Preload headlines and the calendar now, then keep them fresh in the background,
    so the News page answers from memory instead of waiting on the feeds."""
    global _warmer_started
    with _lock:
        if _warmer_started:
            return
        _warmer_started = True

    def loop():
        while True:
            for job in (warm_all, calendar):
                try:
                    job()
                except Exception:
                    pass  # the cache keeps the last good copy; the next pass retries
            time.sleep(interval)

    threading.Thread(target=loop, name="news-warmer", daemon=True).start()
