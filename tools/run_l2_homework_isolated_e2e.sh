#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# EVERYTHING is disposable and local. No cloud project ref, production key or production DB URL is used.
db=yr-l2-e2e-db
auth=yr-l2-e2e-auth
net=yr-l2-e2e-net
postgres_image='postgres@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b'
gotrue_image='supabase/gotrue@sha256:1736a63078f5922b198c4cbe50f80ab9a2d3b54fe8b7b6cfb2e9dc5dbbc12c6b'
jwt_secret=synthetic-local-jwt-secret-at-least-32-bytes
service_jwt="$(node -e 'const c=require("node:crypto"),s=process.argv[1],b=v=>Buffer.from(JSON.stringify(v)).toString("base64url"),h=b({alg:"HS256",typ:"JWT"}),p=b({role:"service_role",iss:"supabase",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400});process.stdout.write(`${h}.${p}.${c.createHmac("sha256",s).update(`${h}.${p}`).digest("base64url")}`)' "$jwt_secret")"
gateway_pid='' homework_pid='' mistake_pid=''
homework_temp=supabase/functions/paper-homework/__isolated_local_e2e.ts
mistake_temp=supabase/functions/student-ch2-mistakes/__isolated_local_e2e.ts
cleanup(){
 for pid in "$homework_pid" "$mistake_pid"; do test -z "$pid" || kill -- "-$pid" 2>/dev/null || true; done
 test -z "$gateway_pid" || kill "$gateway_pid" 2>/dev/null || true
 rm -f "$homework_temp" "$mistake_temp"
 docker rm -f "$auth" "$db" >/dev/null 2>&1 || true
 docker network rm "$net" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker rm -f "$auth" "$db" >/dev/null 2>&1 || true
docker network rm "$net" >/dev/null 2>&1 || true
docker network create "$net" >/dev/null
docker run -d --name "$db" --network "$net" -e POSTGRES_PASSWORD=synthetic_test_only -e POSTGRES_DB=postgres -p 127.0.0.1:55432:5432 "$postgres_image" >/dev/null
for i in $(seq 1 80); do
  if docker exec "$db" psql -U postgres -d postgres -Atc "select 1" 2>/dev/null | grep -qx "1"; then break; fi
  sleep 1
done
docker exec "$db" psql -U postgres -d postgres -Atc "select 1" | grep -qx "1"
docker exec "$db" psql -U postgres -d postgres -c 'create schema if not exists auth;' >/dev/null
docker run -d --name "$auth" --network "$net" -p 127.0.0.1:59999:9999 \
 -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 \
 -e API_EXTERNAL_URL=http://127.0.0.1:58000/auth/v1 \
 -e GOTRUE_SITE_URL=http://127.0.0.1:3000 \
 -e GOTRUE_DB_DRIVER=postgres \
 -e GOTRUE_DB_DATABASE_URL="postgres://postgres:synthetic_test_only@${db}:5432/postgres?sslmode=disable" \
 -e GOTRUE_DB_NAMESPACE=auth -e GOTRUE_JWT_SECRET="$jwt_secret" -e GOTRUE_JWT_EXP=3600 \
 -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
 -e GOTRUE_DISABLE_SIGNUP=false "$gotrue_image" >/dev/null
for i in $(seq 1 100); do curl -fsS http://127.0.0.1:59999/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:59999/health >/dev/null
psql_local=(docker exec -i "$db" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres)
"${psql_local[@]}" < tools/fixtures/l2_homework_e2e_baseline.sql >/dev/null
"${psql_local[@]}" < supabase/migrations/20261024100000_unified_workshop_system.sql >/dev/null
"${psql_local[@]}" < supabase/migrations/20261028120000_ch2_mistake_workshop.sql >/dev/null
"${psql_local[@]}" < supabase/migrations/20261028150000_paper_homework_system.sql >/dev/null
# Dedicated local copies change only Deno.serve's listening port; business logic is unchanged.
sed 's/Deno\.serve(async (req) => {/Deno.serve({ port: 59001 }, async (req) => {/' supabase/functions/paper-homework/index.ts > "$homework_temp"
sed 's/Deno\.serve(async (req) => {/Deno.serve({ port: 59002 }, async (req) => {/' supabase/functions/student-ch2-mistakes/index.ts > "$mistake_temp"
node tools/l2_homework_local_gateway.mjs >/tmp/yr-l2-gateway.log 2>&1 &
gateway_pid=$!
SUPABASE_URL=http://127.0.0.1:58000 SUPABASE_ANON_KEY=synthetic-anon SUPABASE_SERVICE_ROLE_KEY="$service_jwt" \
SUPABASE_DB_URL='postgres://postgres:synthetic_test_only@127.0.0.1:55432/postgres?sslmode=disable' \
DENO_DIR=/tmp/yr-l2-deno-cache npm_config_cache=/tmp/yr-l2-npm-cache \
setsid npx --yes deno@2.9.6 run --allow-net --allow-env --allow-read "$homework_temp" >/tmp/yr-l2-homework.log 2>&1 &
homework_pid=$!
SUPABASE_URL=http://127.0.0.1:58000 SUPABASE_ANON_KEY=synthetic-anon SUPABASE_SERVICE_ROLE_KEY="$service_jwt" \
SUPABASE_DB_URL='postgres://postgres:synthetic_test_only@127.0.0.1:55432/postgres?sslmode=disable' \
DENO_DIR=/tmp/yr-l2-deno-cache npm_config_cache=/tmp/yr-l2-npm-cache \
setsid npx --yes deno@2.9.6 run --allow-net --allow-env --allow-read "$mistake_temp" >/tmp/yr-l2-mistakes.log 2>&1 &
mistake_pid=$!
ready=false
for i in $(seq 1 120); do
 h=$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:58000/functions/v1/paper-homework -H 'content-type: application/json' --data '{"action":"ping"}' || true)
 m=$(curl -sS -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:58000/functions/v1/student-ch2-mistakes -H 'content-type: application/json' --data '{"action":"ping"}' || true)
 if [[ "$h" == 401 && "$m" == 401 ]]; then ready=true; break; fi
 sleep 1
done
if [[ "$ready" != true ]]; then
 echo "Local Edge Functions failed readiness."
 cat /tmp/yr-l2-homework.log /tmp/yr-l2-mistakes.log /tmp/yr-l2-gateway.log >&2
 exit 1
fi
E2E_TARGET=local E2E_SUPABASE_URL=http://127.0.0.1:58000 E2E_DB_CONTAINER="$db" \
E2E_SERVICE_ROLE_KEY="$service_jwt" E2E_ALLOW_WRITES=synthetic-e2e-only \
node tools/tests/lesson2-homework-isolated.e2e.mjs
