# IMPERIUM

[![CI](https://github.com/castefeudal/imperium/actions/workflows/ci.yml/badge.svg)](https://github.com/castefeudal/imperium/actions/workflows/ci.yml)
[![Docker images](https://github.com/castefeudal/imperium/actions/workflows/docker.yml/badge.svg)](https://github.com/castefeudal/imperium/actions/workflows/docker.yml)

Личная операционная система: цели, миссии, знания, здоровье, автоматизация. Монорепозиторий на pnpm-workspace.

## Структура

| Слой | Пакет | Что внутри |
|---|---|---|
| Домен | `packages/domain` | Чистая логика: приоритеты, решения, миссии, память. Без I/O. |
| Данные | `packages/database` | Drizzle-схема, 65 таблиц, миграции, bootstrap. |
| AI | `packages/ai` | Роутер моделей, адаптеры провайдеров, тест-провайдер. |
| Агенты | `packages/agents` | Runtime агентов, бюджет шагов, normalizeUsage. |
| API | `apps/api` | Fastify, 20+ маршрутов: auth, workspaces, goals, evidence, reviews. |
| Web | `apps/web` | Фронтенд (в разработке). |
| Worker | `apps/worker` | Очередь миссий + Redis. |

## Стек

TypeScript 5.7 · Node 22 · Fastify 5 · Drizzle ORM + PostgreSQL 15 (pgvector) · Redis · pnpm workspaces · Vitest

## Запуск

```bash
pnpm install
# БД: см. packages/database/src/bootstrap.ts (DATABASE_URL_ADMIN)
pnpm -r --filter "./apps/*" dev
```

## Тесты

```bash
pnpm -r test   # 12 тестов: domain 9, ai 2, agents 1
```

## Инфраструктура

## Запуск в Docker (production)

```bash
cp .env.example .env   # при необходимости поправьте переменные
docker compose up -d   # postgres+pgvector, redis, api (миграции автоматически), worker, web
```

- Веб-интерфейс: http://localhost:3000 (nginx отдаёт статику и проксирует `/api/` на API)
- API: http://localhost:3100 (health: `GET /health`)
- Образы публикуются CI-пайплайном в GHCR: `ghcr.io/castefeudal/imperium-api`, `ghcr.io/castefeudal/imperium-web`
- Worker использует тот же образ `imperium-api` с командой `worker`

## Прод-деплой из образов GHCR

```bash
docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d
```

- Миграции: `packages/database/drizzle/0000_init.sql`, `0001_goals_soft_delete.sql`
- Интеграции (Google, Gmail, Notion, Linear...) — через OAuth-каталог Zo
- Телеметрия: pino → Loki (`/dev/shm/`)

## Статус

- ✅ Домен: 100% тестов зелёные
- ✅ API: авторизация, CSRF, rate-limit, audit log
- 🔨 Web: каркас

## Деплой (Docker Compose)

```bash
cp .env.example .env
docker compose up -d --build
# web:  http://localhost:8080
# api:  http://localhost:8080/api/v1 (проксировано) или http://localhost:3100 напрямую
```

Состав стека: `postgres` (pgvector), `redis`, `api` (миграции применяются автоматически при старте), `worker`, `web` (nginx, SPA + reverse-proxy `/api`).

Образы публикуются CI в GHCR: `ghcr.io/castefeudal/imperium-api` (worker использует тот же образ с `command: worker`), `ghcr.io/castefeudal/imperium-web`.

## CI

GitHub Actions: PostgreSQL 16 (pgvector) + Redis как сервисы, затем typecheck → lint → тесты (unit + integration) → build web. Публикация Docker-образов при пуше в `main`.
