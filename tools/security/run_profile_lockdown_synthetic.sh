#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
name="yr-profile-hardening-$RANDOM-$$"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$name" -e POSTGRES_PASSWORD=test -e POSTGRES_DB=profile_synthetic postgres:17-alpine >/dev/null
ready=false
for _ in $(seq 1 60); do
  if docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d profile_synthetic -Atc "SELECT 1" 2>/dev/null | grep -qx 1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then echo "Postgres synthetic test DB not ready" >&2; exit 1; fi
sql=(docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d profile_synthetic)
"${sql[@]}" < "$root/tools/security/profile_lockdown_fixture_setup.sql"
"${sql[@]}" < "$root/tools/security/candidate_profile_write_lockdown.sql"
"${sql[@]}" < "$root/tools/security/profile_lockdown_fixture_verify.sql"
echo "Profile ACL target verified using synthetic data only."
