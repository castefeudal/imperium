import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, isNull, SQL } from "drizzle-orm";
import { z } from "zod";
import type { PgTable, PgColumn } from "drizzle-orm/pg-core";
import { getTableColumns } from "drizzle-orm";
import { csrfOk, requireAuth, requireScope } from "../plugins/auth-helpers.js";

export interface CrudConfig {
  table: PgTable;
  idColumn: PgColumn;
  workspaceColumn: PgColumn;
  softDeleteColumn?: PgColumn;
  orderBy?: PgColumn;
  createSchema: z.ZodTypeAny;
  updateSchema: z.ZodTypeAny;
  entityName: string;
}

type Cols = Record<string, PgColumn>;

export function crudRoutes(cfg: CrudConfig): FastifyPluginAsync {
  return async (app) => {
    const cols = getTableColumns(cfg.table) as unknown as Cols;

    app.get("/", async (request, reply) => {
      const auth = await requireAuth(app, request, reply);
      if (!auth) return;
      if (!requireScope(auth, "read", reply)) return;
      const conditions: SQL[] = [eq(cfg.workspaceColumn, auth.workspaceId)];
      if (cfg.softDeleteColumn) conditions.push(isNull(cfg.softDeleteColumn) as SQL);
      const { status } = request.query as { status?: string };
      if (typeof status === "string" && cols.status) conditions.push(eq(cols.status, status));
      const q = app.db.select().from(cfg.table)
        .where(and(...conditions))
        .orderBy(desc(cfg.orderBy ?? cols.createdAt ?? cfg.idColumn))
        .limit(Math.min(Number((request.query as { limit?: string }).limit ?? 100), 200));
      return q;
    });

    app.post("/", async (request, reply) => {
      const auth = await requireAuth(app, request, reply);
      if (!auth) return;
      if (!requireScope(auth, "write", reply)) return;
      if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может создавать записи" });
      if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
      const parsed = cfg.createSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Проверьте данные", detail: parsed.error.flatten().fieldErrors });
      const [row] = await app.db.insert(cfg.table).values({ ...(parsed.data as object), workspaceId: auth.workspaceId }).returning();
      return reply.code(201).send(row);
    });

    app.get("/:id", async (request, reply) => {
      const auth = await requireAuth(app, request, reply);
      if (!auth) return;
      if (!requireScope(auth, "read", reply)) return;
      const rows = await app.db.select().from(cfg.table)
        .where(and(eq(cfg.idColumn, (request.params as { id: string }).id), eq(cfg.workspaceColumn, auth.workspaceId)))
        .limit(1);
      if (!rows[0]) return reply.code(404).send({ error: `${cfg.entityName} не найден(а)` });
      return rows[0];
    });

    app.patch("/:id", async (request, reply) => {
      const auth = await requireAuth(app, request, reply);
      if (!auth) return;
      if (!requireScope(auth, "write", reply)) return;
      if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может изменять записи" });
      if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
      const parsed = cfg.updateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Проверьте данные", detail: parsed.error.flatten().fieldErrors });
      const [row] = await app.db.update(cfg.table)
        .set(parsed.data as Record<string, unknown>)
        .where(and(eq(cfg.idColumn, (request.params as { id: string }).id), eq(cfg.workspaceColumn, auth.workspaceId)))
        .returning();
      if (!row) return reply.code(404).send({ error: `${cfg.entityName} не найден(а)` });
      return row;
    });

    app.delete("/:id", async (request, reply) => {
      const auth = await requireAuth(app, request, reply);
      if (!auth) return;
      if (!["owner", "admin"].includes(auth.role)) return reply.code(403).send({ error: "Недостаточно прав для удаления" });
      if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
      if (cfg.softDeleteColumn) {
        const [row] = await app.db.update(cfg.table)
          .set({ [cfg.softDeleteColumn.name]: new Date() } as Record<string, unknown>)
          .where(and(eq(cfg.idColumn, (request.params as { id: string }).id), eq(cfg.workspaceColumn, auth.workspaceId)))
          .returning();
        if (!row) return reply.code(404).send({ error: `${cfg.entityName} не найден(а)` });
        return { ok: true };
      }
      const deleted = await app.db.delete(cfg.table)
        .where(and(eq(cfg.idColumn, (request.params as { id: string }).id), eq(cfg.workspaceColumn, auth.workspaceId)))
        .returning();
      if (!deleted[0]) return reply.code(404).send({ error: `${cfg.entityName} не найден(а)` });
      return { ok: true };
    });
  };
}
