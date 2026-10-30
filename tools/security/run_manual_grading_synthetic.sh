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
"${psql[@]}" < "$root/tools/security/manual_grading_fixture_production_triggers.sql"
# Mirror the current overly broad grants, then apply the candidate on this local DB only.
"${psql[@]}" -c 'GRANT ALL ON public.attempts,public.responses TO anon,authenticated' >/dev/null
"${psql[@]}" < "$root/tools/security/candidate_attempt_response_write_lockdown.sql"
"${psql[@]}" < "$root/tools/security/candidate_secure_manual_review.sql"
"${psql[@]}" < "$root/tools/security/manual_grading_fixture_verify.sql"
"${psql[@]}" < "$root/tools/security/grade_acl_fixture_verify.sql"
# Two concurrent replays with identical values should serialize without deadlock,
# leave one additional audit entry, and end in an exactly-once grade change.
review_sql="SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',false); SELECT public.review_short_text_response('20000000-0000-4000-8000-000000000001',5,'synthetic concurrent retry');"
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d grade_fixture -Atc "$review_sql" >/dev/null & first=$!
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d grade_fixture -Atc "$review_sql" >/dev/null & second=$!
wait "$first"
wait "$second"
audit_count="$(docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d grade_fixture -Atc "SELECT count(*) FROM private.short_text_grade_audit" | tr -d '[:space:]')"
final_score_correct="$(docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -d grade_fixture -Atc "SELECT CASE WHEN score=5 THEN 'yes' ELSE 'no' END FROM public.attempts WHERE id='10000000-0000-4000-8000-000000000001'" | tr -d '[:space:]')"
echo "Concurrency assertions: audit_count=$audit_count, final_score_correct=$final_score_correct"
test "$audit_count" = "3"
test "$final_score_correct" = "yes"
echo "Secure grading with production-equivalent triggers and concurrent retry passed in disposable Postgres."
