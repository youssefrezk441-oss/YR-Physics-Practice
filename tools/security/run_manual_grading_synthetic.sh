#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
name="yr-manual-grade-fixture-$RANDOM-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=grade_fixture postgres:17-alpine >/dev/null
ready=false
for _ in $(seq 1 60); do
  if docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d grade_fixture -Atc 'select 1' 2>/dev/null | grep -qx 1; then ready=true;break;fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo "Disposable Postgres not available" >&2; exit 1; fi
psql=(docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d grade_fixture)
"${psql[@]}" < "$root/tools/security/manual_grading_fixture_setup.sql"
"${psql[@]}" < "$root/tools/security/candidate_secure_manual_review.sql"
"${psql[@]}" < "$root/tools/security/manual_grading_fixture_verify.sql"
echo "Secure grading candidate verified against disposable SQL database."
