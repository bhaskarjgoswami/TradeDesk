from pathlib import Path

import pytest
from app.journal import news

RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel>
<item><title><![CDATA[BTC <b>jumps</b> &amp; holds]]></title><link>https://example.org/a</link>
<description><![CDATA[<p>Bitcoin rallied.</p>]]></description><pubDate>Mon, 16 Nov 2026 14:12:57 +0530</pubDate></item>
<item><title>Bad link</title><link>javascript:alert(1)</link></item>
<item><title>Investing style date</title><link>https://example.org/b</link><pubDate>2026-11-16 08:18:25</pubDate></item>
</channel></rss>"""

ATOM = b"""<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Gold eases</title>
<link href="https://example.org/c"/><updated>2026-11-16T09:00:00Z</updated><summary>Dollar firmer.</summary></entry></feed>"""


@pytest.fixture(autouse=True)
def clear_cache():
    news._cache.clear()
    news._failed.clear()


def test_local_and_hosted_copies_match():
    root = Path(__file__).resolve().parents[2]
    assert (root / "news.py").read_bytes() == (root / "backend/app/journal/news.py").read_bytes()


def test_parse_rss_cleans_html_drops_unsafe_links_and_normalises_dates():
    items = news.parse_feed(RSS, "Src", "crypto")
    assert [i["link"] for i in items] == ["https://example.org/a", "https://example.org/b"]
    assert items[0]["title"] == "BTC jumps & holds"
    assert items[0]["summary"] == "Bitcoin rallied."
    assert items[0]["published_at"] == "2026-11-16T08:42:57Z"
    assert items[1]["published_at"] == "2026-11-16T08:18:25Z"


def test_parse_atom():
    [item] = news.parse_feed(ATOM, "Src", "global")
    assert item["link"] == "https://example.org/c" and item["published_at"] == "2026-11-16T09:00:00Z"


def test_parse_calendar_filters_and_sorts():
    data = b'[{"title":"CPI m/m","country":"USD","date":"2026-11-18T08:30:00-05:00","impact":"High","forecast":"0.3%","previous":"0.2%"},' \
           b'{"title":"Speech","country":"EUR","date":"2026-11-17T04:00:00-05:00","impact":"Medium"},{"title":"x","date":"bad","impact":"High"}]'
    events = news.parse_calendar(data)
    assert [e["title"] for e in events] == ["Speech", "CPI m/m"]
    assert events[1] == {"title": "CPI m/m", "currency": "USD", "at": "2026-11-18T13:30:00Z", "impact": "high", "forecast": "0.3%", "previous": "0.2%"}


def test_headlines_dedupes_sorts_and_reports_failed_sources(monkeypatch):
    monkeypatch.setattr(news, "FEEDS", {"crypto": {"*": [("A", "https://a"), ("Dead", "https://dead")]}, "macro": {"*": [("B", "https://b")]}})
    def fake_get(url):
        if url == "https://dead":
            raise OSError("down")
        return RSS if url == "https://a" else ATOM.replace(b"Gold eases", b"BTC jumps &amp; holds")
    monkeypatch.setattr(news, "_get", fake_get)
    result = news.headlines("all")
    assert result["failed"] == ["Dead"]
    assert [i["link"] for i in result["items"]] == ["https://example.org/a", "https://example.org/b"]
    with pytest.raises(ValueError):
        news.headlines("nope")


def test_cache_serves_stale_value_and_backs_off_after_failure(monkeypatch):
    calls = []
    def load():
        calls.append(1)
        if len(calls) > 1:
            raise OSError("429")
        return "first"
    clock = [1000.0]
    monkeypatch.setattr(news.time, "time", lambda: clock[0])
    assert news._cached("k", 10, load) == "first"
    clock[0] += 11
    assert news._cached("k", 10, load) == "first"   # failed refresh -> stale value
    clock[0] += 11
    assert news._cached("k", 10, load) == "first"   # within back-off: no new request
    assert len(calls) == 2
    news._cache.clear()
    with pytest.raises(RuntimeError):
        news._cached("k", 10, load)                  # no cached value and still backing off


def test_news_preferences_are_validated_with_defaults_and_legacy_topics():
    from app.journal import workspace
    base = dict(currency="USD", capital=0, name="J", displayCurrency="USD", fxRate=1, fxAt="")
    clean = workspace.validate_settings("preferences", base)
    assert clean["newsRegions"] == ["stocks", "forex", "commodities", "crypto"] and clean["newsCountry"] == "global"
    clean = workspace.validate_settings("preferences", {**base, "newsRegions": ["ipo", "crypto"], "newsCountry": "in"})
    assert clean["newsRegions"] == ["crypto", "ipo"] and clean["newsCountry"] == "in"
    assert workspace.validate_settings("preferences", {**base, "newsRegions": ["india", "global"]})["newsRegions"] == ["stocks", "macro"]
    for bad in ([], ["nope"], "crypto"):
        with pytest.raises(ValueError):
            workspace.validate_settings("preferences", {**base, "newsRegions": bad})
    with pytest.raises(ValueError):
        workspace.validate_settings("preferences", {**base, "newsCountry": "mars"})
    assert workspace.validate_settings("preferences", {**base, "newsCountry": "gb"})["newsCountry"] == "gb"


def test_headlines_accepts_a_list_of_topics(monkeypatch):
    monkeypatch.setattr(news, "FEEDS", {"crypto": {"*": [("A", "https://a")]}, "ipo": {"*": [("B", "https://b")]}, "bonds": {"*": [("C", "https://c")]}})
    monkeypatch.setattr(news, "_get", lambda url: RSS if url == "https://a" else ATOM)
    assert {i["cat"] for i in news.headlines("crypto,ipo")["items"]} == {"crypto", "ipo"}
    with pytest.raises(ValueError):
        news.headlines("crypto,nope")


def test_country_picks_local_sources_and_falls_back_to_default(monkeypatch):
    monkeypatch.setattr(news, "FEEDS", {"stocks": {"*": [("World", "https://w")], "in": [("Local", "https://l")]}})
    monkeypatch.setattr(news, "_get", lambda url: RSS)
    assert {i["source"] for i in news.headlines("stocks", "in")["items"]} == {"Local"}
    assert {i["source"] for i in news.headlines("stocks", "us")["items"]} == {"World"}
    with pytest.raises(ValueError):
        news.headlines("stocks", "mars")


def test_calendar_reuses_recent_copy_on_disk(monkeypatch, tmp_path):
    path = tmp_path / "cal.json"
    monkeypatch.setattr(news, "CALENDAR_FILE", str(path))
    calls = []
    data = b'[{"title":"CPI","country":"USD","date":"2026-11-18T08:30:00-05:00","impact":"High"}]'
    monkeypatch.setattr(news, "_get", lambda url: calls.append(url) or data)
    assert news.calendar("high")["events"][0]["title"] == "CPI"
    news._cache.clear()                       # simulate a server restart
    assert news.calendar("high")["events"][0]["title"] == "CPI"
    assert len(calls) == 1


def test_impact_score_separates_market_movers_from_noise():
    high = ["Fed Chairman Warsh signals rate cut in December", "US CPI rises 0.4%, hotter than expected",
            "Sensex crashes 1,200 points as FPIs sell", "Gold hits record high as dollar slides"]
    low = ["Elon Musk Joins 160,000 Backing Petition to Bring Jensen Huang Back to Nvidia",
           "Capacit'e Infraprojects shares gain 6% on ₹670-crore CIDCO order win",
           "UPL Share Price Live Updates: UPL Surges Above 100-Day EMA", "5 stocks to buy this week"]
    assert all(news.impact_score(t) >= news.HIGH_IMPACT for t in high)
    assert all(news.impact_score(t) < news.HIGH_IMPACT for t in low)
    assert "impact" in news.parse_feed(RSS, "Src", "crypto")[0]


def test_index_news_keeps_on_topic_headlines_and_strips_publisher():
    feed = b"""<rss><channel>
<item><title>Sensex jumps 500 points, Nifty ends above 25,250 - Mint</title><link>https://news.google.com/a</link><source>Mint</source><pubDate>Mon, 16 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>ASEAN seeks stronger tech ties - Nikkei Asia</title><link>https://news.google.com/b</link><source>Nikkei Asia</source><pubDate>Mon, 16 Nov 2026 11:00:00 GMT</pubDate></item>
<item><title>3 Nifty stocks to buy now - Blog</title><link>https://news.google.com/c</link><source>Blog</source></item>
<item><title>Revenue Breakdown NSE:TCS - TradingView</title><link>https://news.google.com/d</link><source>TradingView</source></item>
</channel></rss>"""
    news._cache.clear()
    import unittest.mock as m
    with m.patch.object(news, "_get", lambda url: feed):
        items = news.index_news("in")["items"]
    assert [(i["title"], i["source"]) for i in items] == [("Sensex jumps 500 points, Nifty ends above 25,250", "Mint")]
    with pytest.raises(ValueError):
        news.index_news("mars")
