#!/bin/bash
# Double-click to start the local journal and open it once it is ready.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON=""
for candidate in /opt/homebrew/bin/python3 /usr/local/bin/python3 /usr/bin/python3; do
  if [[ -x "$candidate" ]]; then
    PYTHON="$candidate"
    break
  fi
done
if [[ -z "$PYTHON" ]]; then
  echo 'Python 3 was not found. Install Python 3, then try again.'
  exit 1
fi

PORT="${TRADE_PORT:-8787}"
if ! "$PYTHON" -c 'import sys; p=int(sys.argv[1]); assert 1 <= p <= 65535' "$PORT" 2>/dev/null; then
  echo 'TRADE_PORT must be a number between 1 and 65535.'
  exit 1
fi
URL="http://localhost:$PORT"
LOG="$(pwd)/trade-journal.log"

journal_ready() {
  "$PYTHON" - "$PORT" <<'PY'
import sys, urllib.request
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:' + sys.argv[1], timeout=1) as response:
        page = response.read(12000).decode('utf-8', errors='replace')
        ready = response.status == 200 and '<title>Trade Journal</title>' in page
    raise SystemExit(0 if ready else 1)
except Exception:
    raise SystemExit(1)
PY
}

if journal_ready; then
  echo "Trade Journal is already running: $URL"
  open "$URL"
  exit 0
fi

umask 077
# A separate session survives both Terminal exit and the launching process ending.
SERVER_PID="$("$PYTHON" - "$LOG" <<'PYTHON'
import os, subprocess, sys
with open(sys.argv[1], 'wb') as log:
    process = subprocess.Popen(
        [sys.executable, '-u', 'app.py'], stdin=subprocess.DEVNULL,
        stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        env=dict(os.environ, TRADE_HOST='127.0.0.1'))
print(process.pid)
PYTHON
)"
for ((attempt=0; attempt<40; attempt++)); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Trade Journal could not start. See $LOG"
    exit 1
  fi
  if journal_ready; then
    echo "Trade Journal is running: $URL"
    open "$URL"
    exit 0
  fi
  sleep 0.25
done

echo "Trade Journal is still starting. Check $URL or see $LOG"
exit 1
