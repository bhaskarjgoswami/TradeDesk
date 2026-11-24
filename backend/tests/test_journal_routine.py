import contextlib
import sqlite3

import pytest

from app.journal import core


@pytest.fixture
def journal(monkeypatch, tmp_path):
    path = tmp_path / "journal.db"

    @contextlib.contextmanager
    def db():
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    monkeypatch.setattr(core, "db", db)
    core.init_db()
    core.init_plan_settings()
    core.init_routine()
    return core


def _add_trades(journal, n):
    with journal.db() as conn:
        for i in range(n):
            conn.execute("INSERT INTO trades(date,symbol,direction) VALUES(?,?,?)", (f"2026-01-0{i+1}", "SPY", "Long"))


def test_brand_new_journal_starts_without_the_routine(journal):
    settings = journal.routine_state()["settings"]
    assert settings["enabled"] is False and settings["popup"] is True


def test_new_cloud_journal_opens_desktop_popup(journal):
    _add_trades(journal, journal.FIRST_RUN_TRADES)
    state = journal.routine_state()
    assert state["settings"]["enabled"] is True
    assert state["settings"]["popup"] is True
    plan, meditation = state["settings"]["steps"]
    assert plan["action"] == "preferences"
    assert meditation["action"] == "focus"
    assert meditation["meditation"] == "visualize-plan"
    assert state["checked"] == []


def test_saved_routine_choice_survives_new_defaults(journal):
    state = journal.routine_state()
    settings = state["settings"]
    settings["popup"] = False
    settings["steps"] = [dict(id="custom", title="My checklist", action="none", icon="target")]
    saved = journal.save_routine({"revision": state["revision"], "settings": settings})
    reloaded = journal.routine_state()
    assert reloaded["settings"]["popup"] is False
    assert reloaded["settings"]["steps"][0]["title"] == "My checklist"
    assert reloaded["revision"] == saved["revision"]
