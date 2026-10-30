#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
name="yr-authz-fixture-$RANDOM-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=authz_fixture postgres:17-alpine >/dev/null
ready=false
for _ in $(seq 1 60); do
  if docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d authz_fixture -Atc 'SELECT 1' 2>/dev/null | grep -qx 1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo "Disposable PostgreSQL never became ready" >&2; exit 1; fi
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d authz_fixture < "$root/tools/security/legacy-authz-synthetic.sql"
echo "Synthetic student authorization boundary verified (no production access)."
