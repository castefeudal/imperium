# Локальный запуск IMPERIUM

Полный стек: Postgres 15 + Redis + API (Fastify) + Worker (очередь миссий) + Web (Vite/React).

## Зависимости

- Node.js 22+, pnpm 10
- PostgreSQL 15 (локально или в docker)
- Redis 6+

## Шаги

```bash
# 1. Установить зависимости
pnpm install

# 2. Поднять Postgres и Redis
#    (пример для локальной установки Debian/Ubuntu)
sudo service postgresql start && sudo service redis-server start

# 3. Создать БД и пользователя (если ещё нет)
sudo -u postgres psql -c "CREATE USER imperium WITH PASSWORD 'imperium_dev';"
sudo -u postgres psql -c "CREATE DATABASE imperium OWNER imperium;"

# 4. Применить схему и сид-данные
pnpm --filter @imperium/database db:push
pnpm --filter @imperium/database db:seed
# Демо-доступ: demo@imperium.local / imperium-demo-2026

# 5. Запустить API (порт 3101)
pnpm --filter @imperium/api dev

# 6. Запустить worker (обработчик очереди миссий) — в отдельном терминале
pnpm --filter @imperium/worker dev

# 7. Запустить веб-клиент — в третьем терминале
pnpm --filter @imperium/web dev
```

## Сквозной сценарий (проверено)

1. Войти через UI или `POST /api/v1/auth/login` (`demo@imperium.local` / `imperium-demo-2026`).
2. Создать миссию: `POST /api/v1/missions` `{ "title": "...", "objective": "..." }`.
3. Запустить: `POST /api/v1/missions/:id/run` — создаст `agent_run`, синтезирует первый шаг (если шагов нет) и поставит задачу в очередь Redis (`imperium:missions:queue`).
4. Worker заберёт задачу, выполнит шаг через модель, запишет результат шага и расход в `cost_ledger`, переведёт миссию в `reviewing`.

## Переменные окружения

| Переменная | По умолчанию |
| --- | --- |
| `DATABASE_URL` | `postgresql://imperium:imperium_dev@127.0.0.1:5432/imperium` |
| `REDIS_URL` | `redis://127.0.0.1:6379` |
| `PORT` (API) | `3101` |
| `SEED_EMAIL` / `SEED_PASSWORD` | `demo@imperium.local` / `imperium-demo-2026` |

## Тесты

```bash
pnpm -r --if-present test        # юнит-тесты пакетов + API (vitest)
pnpm test:e2e                    # Playwright smoke (поднимает API и web)
```
