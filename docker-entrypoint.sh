#!/bin/sh
set -e
cd /app

cmd="${1:-api}"

wait_for_db() {
  echo "Waiting for postgres at ${DATABASE_URL:-unset DATABASE_URL}..."
  i=0
  until pnpm --filter @imperium/database exec node -e "const c=require('postgres')(process.env.DATABASE_URL,{max:1});c\`select 1\`.then(()=>{console.log('db up');return c.end();}).catch(e=>{console.error(e.message);process.exit(1);})" 2>/dev/null; do
    i=$((i+1))
    if [ "$i" -ge 60 ]; then echo "Postgres not reachable after 60 attempts" >&2; exit 1; fi
    sleep 2
  done
}

case "$cmd" in
  api)
    wait_for_db
    echo "Running migrations..."
    pnpm --filter @imperium/database migrate
    exec pnpm --filter @imperium/api exec tsx src/index.ts
    ;;
  worker)
    wait_for_db
    exec pnpm --filter @imperium/worker exec tsx src/index.ts
    ;;
  *)
    exec "$cmd"
    ;;
esac
