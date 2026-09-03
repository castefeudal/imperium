# IMPERIUM

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

- Миграции: `packages/database/drizzle/0000_init.sql`, `0001_goals_soft_delete.sql`
- Интеграции (Google, Gmail, Notion, Linear...) — через OAuth-каталог Zo
- Телеметрия: pino → Loki (`/dev/shm/`)

## Статус

- ✅ Домен: 100% тестов зелёные
- ✅ API: авторизация, CSRF, rate-limit, audit log
- 🔨 Web: каркас
