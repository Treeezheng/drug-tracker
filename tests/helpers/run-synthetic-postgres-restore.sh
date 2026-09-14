#!/bin/sh
# Create a new local cluster for this drill. Never read DATABASE_URL or an existing backup.
set -eu
: "${PG_BIN:?Set PG_BIN to the PostgreSQL binary directory containing initdb, pg_ctl, pg_dump and pg_restore.}"
NODE_BIN=${NODE_BIN:-node}
PYTHON_BIN=${PYTHON_BIN:-python3}
review_root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
review_cluster=$(mktemp -d "${TMPDIR:-/tmp}/drug-synthetic-restore.XXXXXX")
cleanup() {
  "$PG_BIN/pg_ctl" -D "$review_cluster/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$review_cluster"
}
trap cleanup EXIT HUP INT TERM
review_port=$("$PYTHON_BIN" - <<'PY'
import socket
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    print(sock.getsockname()[1])
PY
)
"$PG_BIN/initdb" -D "$review_cluster/data" -A trust -U drug_test -E UTF8 --locale=C > "$review_cluster/init.log"
"$PG_BIN/pg_ctl" -D "$review_cluster/data" -l "$review_cluster/server.log" -o "-h 127.0.0.1 -p $review_port -k $review_cluster" -w start
cd "$review_root"
DRUG_TEST_POSTGRES_URL="postgres://drug_test@127.0.0.1:$review_port/postgres" \
DRUG_ROUND2_PG_BIN="$PG_BIN" DRUG_ROUND2_DUMP="$review_cluster/synthetic.dump" \
  "$NODE_BIN" --import tsx tests/helpers/synthetic-postgres-restore.mjs
