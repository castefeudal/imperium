import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { requireAuth } from "../plugins/auth-helpers.js";

/**
 * Лексический поиск по воркспейсу (PostgreSQL ILIKE по заголовку и телу).
 * Работает без внешних провайдеров: один UNION ALL-запрос по ключевым сущностям.
 * Возвращает нормализованные результаты: kind, id, title, snippet, score, updatedAt.
 */
const TS_COL: Record<string, string> = {
  tasks: "updated_at",
  notes: "updated_at",
  goals: "updated_at",
  projects: "updated_at",
  documents: "created_at",
  missions: "created_at",
  people: "created_at",
  decisions: "updated_at",
};

export const registerSearchRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;

    const parsed = z
      .object({
        q: z.string().min(1).max(500),
        kind: z.enum(["task", "note", "goal", "project", "document", "mission", "person", "decision"]).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Проверьте параметры поиска", detail: parsed.error.flatten().fieldErrors });
    }
    const { q, kind, limit } = parsed.data;
    const ws = auth.workspaceId;
    const like = `%${q.replace(/[%_\\]/g, "\\$&")}%`;

    // Каждый блок: title (обязателен), snippet, score (1 = точное совпадение в заголовке, 0.4 — в тексте)
    const blocks: { kind: string; table: string; titleCol: string; bodyCol: string | null }[] = [
      { kind: "task", table: "tasks", titleCol: "title", bodyCol: "description" },
      { kind: "note", table: "notes", titleCol: "title", bodyCol: "body" },
      { kind: "goal", table: "goals", titleCol: "title", bodyCol: "description" },
      { kind: "project", table: "projects", titleCol: "title", bodyCol: "summary" },
      { kind: "document", table: "documents", titleCol: "title", bodyCol: null },
      { kind: "mission", table: "missions", titleCol: "title", bodyCol: "objective" },
      { kind: "person", table: "people", titleCol: "name", bodyCol: "notes" },
      { kind: "decision", table: "decisions", titleCol: "question", bodyCol: "objective" },
    ];
    const wanted = kind ? blocks.filter((b) => b.kind === kind) : blocks;
    if (wanted.length === 0) return { query: q, results: [], count: 0 };

    const parts = wanted.map((b) => {
      const titleExpr = sql`t.${sql.raw(`"${b.titleCol}"`)}`;
      const matchExpr = b.bodyCol
        ? sql`(${titleExpr} ILIKE ${like} OR t.${sql.raw(`"${b.bodyCol}"`)} ILIKE ${like})`
        : sql`${titleExpr} ILIKE ${like}`;
      const snippetExpr = b.bodyCol
        ? sql`COALESCE(NULLIF(t.${sql.raw(`"${b.bodyCol}"`)}, ''), '')`
        : sql`''`;
      return sql`
      SELECT ${b.kind} AS kind, t.id::text AS id,
             ${titleExpr} AS title,
             ${snippetExpr} AS snippet,
             CASE WHEN ${titleExpr} ILIKE ${like} THEN 1 ELSE 0.4 END AS score,
             ${sql.raw(`t.${TS_COL[b.table] ?? "created_at"}`)} AS "updatedAt"
      FROM ${sql.raw(`"${b.table}"`)} t
      WHERE t.workspace_id = ${ws}
        AND ${matchExpr}
    `;
    });

    const query = parts.length === 1 ? parts[0] : sql.join(parts, sql` UNION ALL `);
    const rows = await app.db.execute(
      sql`SELECT * FROM (${query}) s ORDER BY s.score DESC, s."updatedAt" DESC NULLS LAST LIMIT ${limit}`,
    );
    const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as Array<Record<string, unknown>>;
    const results = list.map((r) => ({
      kind: String(r.kind ?? ""),
      id: String(r.id ?? ""),
      title: String(r.title ?? ""),
      snippet: String(r.snippet ?? "").slice(0, 180),
      score: Number(r.score ?? 0),
      updatedAt: r.updatedAt ? String(r.updatedAt) : null,
    }));
    return { query: q, results, count: results.length };
  });
};
