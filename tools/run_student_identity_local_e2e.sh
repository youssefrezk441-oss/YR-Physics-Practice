#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

db_container=yr-identity-e2e-db
auth_container=yr-identity-e2e-auth
network=yr-identity-e2e-net
jwt_secret=synthetic-local-jwt-secret-at-least-32-bytes
service_jwt="$(node -e 'const c=require("node:crypto"),s=process.argv[1],b=v=>Buffer.from(JSON.stringify(v)).toString("base64url"),h=b({alg:"HS256",typ:"JWT"}),p=b({role:"service_role",iss:"supabase",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400});process.stdout.write(`${h}.${p}.${c.createHmac("sha256",s).update(`${h}.${p}`).digest("base64url")}`)' "$jwt_secret")"
gateway_pid=
function_pid=

cleanup() {
  test -z "$function_pid" || kill "$function_pid" 2>/dev/null || true
  test -z "$gateway_pid" || kill "$gateway_pid" 2>/dev/null || true
  docker rm -f "$auth_container" "$db_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker rm -f "$auth_container" "$db_container" >/dev/null 2>&1 || true
docker network rm "$network" >/dev/null 2>&1 || true
docker network create "$network" >/dev/null
docker run -d --name "$db_container" --network "$network" \
  -e POSTGRES_PASSWORD=synthetic_test_only -e POSTGRES_DB=postgres \
  -p 127.0.0.1:55432:5432 postgres:17-alpine >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$db_container" psql -U postgres -d postgres -Atc 'select 1' >/dev/null 2>&1; then
    ready=$((ready + 1))
    test "$ready" -lt 3 || break
  else
    ready=0
  fi
  sleep 1
done
test "$ready" -ge 3
docker exec "$db_container" psql -U postgres -d postgres -Atc 'select 1' >/dev/null
docker exec "$db_container" psql -U postgres -d postgres -c 'create schema auth' >/dev/null

docker run -d --name "$auth_container" --network "$network" \
  -p 127.0.0.1:59999:9999 \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 \
  -e API_EXTERNAL_URL=http://127.0.0.1:58000/auth/v1 \
  -e GOTRUE_SITE_URL=http://127.0.0.1:3000 \
  -e GOTRUE_URI_ALLOW_LIST=http://127.0.0.1:3000 \
  -e GOTRUE_DB_DRIVER=postgres \
  -e GOTRUE_DB_DATABASE_URL="postgres://postgres:synthetic_test_only@${db_container}:5432/postgres?sslmode=disable" \
  -e GOTRUE_DB_NAMESPACE=auth -e GOTRUE_JWT_SECRET="$jwt_secret" -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
  -e GOTRUE_DISABLE_SIGNUP=false supabase/gotrue:v2.197.0 >/dev/null

for _ in $(seq 1 90); do
  curl -fsS http://127.0.0.1:59999/health >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS http://127.0.0.1:59999/health >/dev/null

docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < tools/fixtures/student_identity_local_baseline.sql >/dev/null
docker exec -i "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  < supabase/migrations/20261028190000_student_identity_registration_v1.sql >/dev/null
docker exec "$db_container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'alter role postgres set search_path=auth,public' >/dev/null

LOCAL_FUNCTION_ORIGIN=http://127.0.0.1:8000 node tools/student_identity_local_gateway.mjs \
  >/tmp/yr-identity-gateway.log 2>&1 &
gateway_pid=$!

SUPABASE_URL=http://127.0.0.1:58000 \
SUPABASE_ANON_KEY=synthetic-anon \
SUPABASE_SERVICE_ROLE_KEY="$service_jwt" \
SUPABASE_DB_URL='postgres://postgres:synthetic_test_only@127.0.0.1:55432/postgres?sslmode=disable' \
STUDENT_IDENTITY_ENCRYPTION_KEY_B64='MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=' \
STUDENT_IDENTITY_HMAC_KEY_B64='ZmVkY2JhOTg3NjU0MzIxMGZlZGNiYTk4NzY1NDMyMTA=' \
STUDENT_IDENTITY_TEST_FAILPOINTS=synthetic-e2e-only \
DENO_DIR=/tmp/yr-deno-cache npm_config_cache=/tmp/yr-npm-cache \
npx --yes deno run --allow-net --allow-env supabase/functions/student-identity/index.ts \
  >/tmp/yr-identity-function.log 2>&1 &
function_pid=$!

for _ in $(seq 1 60); do
  curl -fsS -X POST -H 'content-type: application/json' \
    --data '{"action":"config"}' http://127.0.0.1:58000/functions/v1/student-identity >/dev/null 2>&1 && break
  sleep 1
done

E2E_TARGET=local E2E_SUPABASE_URL=http://127.0.0.1:58000 \
E2E_ANON_KEY=synthetic-anon E2E_SERVICE_ROLE_KEY="$service_jwt" \
E2E_DB_CONTAINER="$db_container" E2E_ALLOW_WRITES=synthetic-e2e-only \
node --test tools/tests/student-identity-staging.integration.mjs
