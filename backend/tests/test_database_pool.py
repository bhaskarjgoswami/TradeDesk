import threading
import time

import psycopg2
import pytest

from app import database


class FakeConn:
    closed = False

    class info:
        transaction_status = psycopg2.extensions.TRANSACTION_STATUS_IDLE

    def close(self):
        self.closed = True

    def rollback(self):
        pass


@pytest.fixture
def slow_connect(monkeypatch):
    opened = []

    def connect(*args, **kwargs):
        time.sleep(0.2)  # a TLS handshake to a far-away database
        conn = FakeConn()
        opened.append(conn)
        return conn

    monkeypatch.setattr(database.psycopg2, "connect", connect)
    return opened


def burst(pool, n, hold=0.05):
    def work():
        conn = pool.getconn()
        time.sleep(hold)
        pool.putconn(conn)

    threads = [threading.Thread(target=work) for _ in range(n)]
    start = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    return time.monotonic() - start


def test_parallel_requests_open_connections_side_by_side_and_keep_them(slow_connect):
    pool = database.ReusingPool(0, 20, "dbname=fake")
    first = burst(pool, 10)
    # Opened one after another this would take 10 x 0.2 s.
    assert first < 1.0
    assert len(slow_connect) == 10
    assert all(not c.closed for c in slow_connect)
    # A second page load reuses every connection: nothing new is opened.
    second = burst(pool, 10)
    assert len(slow_connect) == 10
    assert second < 0.5


def test_full_pool_waits_for_a_free_connection_instead_of_failing(slow_connect):
    pool = database.ReusingPool(0, 2, "dbname=fake")
    burst(pool, 6, hold=0.1)
    assert len(slow_connect) == 2


def test_full_pool_still_fails_after_the_wait(slow_connect, monkeypatch):
    monkeypatch.setattr(database, "POOL_WAIT_SECONDS", 0.1)
    pool = database.ReusingPool(0, 1, "dbname=fake")
    held = pool.getconn()
    with pytest.raises(psycopg2.pool.PoolError):
        pool.getconn()
    pool.putconn(held)


def test_failed_connect_frees_its_slot(monkeypatch):
    def refuse(*args, **kwargs):
        raise psycopg2.OperationalError("down")

    monkeypatch.setattr(database.psycopg2, "connect", refuse)
    pool = database.ReusingPool(0, 1, "dbname=fake")
    for _ in range(3):
        with pytest.raises(psycopg2.OperationalError):
            pool.getconn()
