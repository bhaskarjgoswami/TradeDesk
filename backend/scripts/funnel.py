"""Print the activation funnel from first-party product events (app/events.py).

Usage (read-only):  DATABASE_URL=postgresql://... python scripts/funnel.py [days]

Accounts are grouped by the day they first opened the app, limited to the last
`days` days (default 60). For each step it prints how many of those accounts got
there, so you can see where people drop off.
"""
import os
import sys

import psycopg2

DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 60

SQL = """
WITH first_open AS (
    SELECT user_id, min(day) AS d0 FROM analytics.product_events
    WHERE name = 'app_open' GROUP BY user_id
    HAVING min(day) >= (now() AT TIME ZONE 'utc')::date - %(days)s
),
steps AS (
    SELECT f.user_id,
        bool_or(e.name = 'trade_logged' AND e.day <= f.d0 + 1) AS trade_day1,
        bool_or(e.name = 'trade_logged') AS trade_any,
        bool_or(e.name = 'trade_reviewed') AS reviewed,
        bool_or(e.name = 'routine_completed') AS routine,
        bool_or(e.name = 'app_open' AND e.day >= f.d0 + 7) AS back_week2
    FROM first_open f JOIN analytics.product_events e USING (user_id)
    GROUP BY f.user_id
)
SELECT count(*) AS accounts,
    count(*) FILTER (WHERE trade_day1) AS trade_day1,
    count(*) FILTER (WHERE trade_any) AS trade_any,
    count(*) FILTER (WHERE reviewed) AS reviewed,
    count(*) FILTER (WHERE routine) AS routine,
    count(*) FILTER (WHERE back_week2) AS back_week2
FROM steps
"""

LABELS = [
    ("accounts", "Opened the app"),
    ("trade_day1", "Logged a trade within a day"),
    ("trade_any", "Logged a trade at all"),
    ("reviewed", "Reviewed a trade"),
    ("routine", "Completed the routine"),
    ("back_week2", "Came back after 7+ days"),
]


def main():
    url = os.environ.get("DATABASE_URL")
    if not url:
        sys.exit("Set DATABASE_URL")
    with psycopg2.connect(url) as conn, conn.cursor() as cur:
        cur.execute("SET TRANSACTION READ ONLY")
        cur.execute("SELECT to_regclass('analytics.product_events')")
        if not cur.fetchone()[0]:
            sys.exit("No events recorded yet")
        cur.execute(SQL, {"days": DAYS})
        row = dict(zip([c[0] for c in cur.description], cur.fetchone()))
    base = row["accounts"] or 1
    print(f"Accounts first seen in the last {DAYS} days")
    for key, label in LABELS:
        print(f"  {label:<32} {row[key]:>6}  {row[key] / base:6.0%}")


if __name__ == "__main__":
    main()
