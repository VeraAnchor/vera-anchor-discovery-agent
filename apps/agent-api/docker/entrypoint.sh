#!/bin/sh
set -eu

: "${AGENT_DATABASE_URL:?AGENT_DATABASE_URL is required}"

echo "[agent-api] waiting for database"

db_ready=0

for i in $(seq 1 60); do
  if pg_isready -d "$AGENT_DATABASE_URL" >/dev/null 2>&1; then
    db_ready=1
    break
  fi

  sleep 1
done

if [ "$db_ready" != "1" ]; then
  echo "[agent-api] database not ready"
  exit 1
fi

echo "[agent-api] database ready"

exec "$@"