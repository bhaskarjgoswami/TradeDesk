# Local Trade Journal

Start with `Start Trade Journal.command`, then open http://localhost:8787.
This is the local Python + SQLite app. It uses `app.py`, `workspace.py`, `index.html`, `workspace.js`, `calendar.js`, `trade.js`, `playbook.js`, `profile.js`, `meditation.js`, `workspace.css`, `theme.css`, and `theme-mercury.css`. The separate `frontend/` and `backend/` folders are not used by this launcher.

## Pages

| Page | What it does |
| --- | --- |
| Journal | Month calendar of daily results ($, % of starting balance, or R), monthly summary with R distribution, and weekly breakdown. Click a day to see its trades. |
| Add / Edit Trade | The journal entry, written after you exit a trade or pulled from Delta. Trade details, HTF/MTF/LTF charts, and review (plan followed, management, mistakes, emotions, notes). P&L, risk and R fill in from prices until you type your own. |
| Trades | Search, filter, import, export and review trades. |
| Stats | Net P&L, win rate, expectancy, drawdown, equity curve and breakdowns. |
| Playbook | Your strategies and pre-trade checklists. Kept separate from the trade journal. |
| Settings | Pre-market routine (optional popup), checklist defaults, currency, starting balance, exchange import, appearance and backups. |

## Amounts and results

- Use one currency per journal. The default is USD. Change it before adding trades in another currency.
- Currency labels do not convert values. The app refuses a currency change once trades exist.
- Enter gross realized P&L in the trade form. Enter fees separately. Net P&L subtracts fees.
- Trades without realized P&L remain open. They do not count toward closed-trade win rate.
- Win rate includes break-even trades in its denominator. Wins and losses use net results.
- Profit factor uses total positive net trade results divided by total absolute negative net trade results.
- Plan adherence uses reviewed trades that have a Yes/No answer to plan following.
- Equity starts at zero cumulative P&L. Journal balance adds the starting balance from Settings.
- Drawdown in Performance is the largest fall from a recorded peak.

## CSV import

Download the column template in Trade History → Import CSV. Required columns are `date`, `symbol`, and `direction`.

- Date format: `YYYY-MM-DD`.
- Direction: `Long` or `Short`.
- Amounts must already use the journal's currency.
- `pnl` means gross realized P&L. `fee` is separate.
- `contract_value` is optional; it defaults to 1 when deriving P&L or risk.
- When P&L is blank, entry, exit and quantity can calculate it.
- Preview the file, then click Import trades. Validation happens before records are added.
- Import up to 1,000 trades per file. Identical CSV records are skipped on repeat imports.
- Edited versions of a CSV record are separate input records. The importer does not match broker order IDs.

## Backup

Settings → Journal → Download full backup exports a ZIP with `journal.db` and uploaded charts under `images/`.
The archive contains journal records, plans, notes, preferences, routines, events, and focus history. It excludes `.env`, broker credential files, and login sessions.

To restore a backup, stop the local app first. Keep a copy of the current `trades.db` and `images/`. Extract `journal.db` as `trades.db` in this folder and restore `images/`, then start the launcher. Backups contain private journal data.

## Integration status

- Delta Exchange: existing read-only import of today's fills is retained. Review the imported records before saving. Repeated manual Delta imports are not automatically deduplicated.
- Broker order placement: not connected. The app sends no trade orders.
- Chart replay: not connected. Trade review displays uploaded chart screenshots.
- AI coaching: not connected. Session analysis, patterns and the report are deterministic calculations from your saved records.

All records stay in the local journal database. Editing shared plan defaults changes new trades. Saved trade plans keep their original snapshot. Workspace editors use revisions to reject conflicting saves from another tab.
