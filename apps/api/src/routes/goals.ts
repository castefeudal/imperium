import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { goals, areas, projects, tasks } from "@imperium/database";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAuth } from "../plugins/auth-helpers.js";

const createSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  areaId: z.string().uuid().optional(),
  status: z.enum(["draft", "active", "paused", "done", "dropped"]).default("active"),
  targetDate: z.string().datetime().optional(),
  successMetric: z.string().max(500).optional(),
  baseline: z.string().max(500).optional(),
  target: z.string().max(500).optional(),
  priority: z.number().int().min(0).max(100).default(50),
  motivation: z.string().max(2000).optional(),
  parentGoalId: z.string().uuid().optional(),
});

const updateSchema = createSchema.partial();

export const registerGoalsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const rows = await app.db.select().from(goals)
      .where(and(eq(goals.workspaceId, auth.workspaceId), isNull(goals.deletedAt)))
      .orderBy(desc(goals.createdAt)).limit(200);
    const withProgress = await Promise.all(rows.map(async (g) => {
      const gs = await app.db.select().from(projects).where(eq(projects.goalId, g.id));
      const ts = await app.db.select().from(tasks).where(eq(tasks.goalId, g.id));
      const done = ts.filter((t) => t.status === "completed").length;
      return { ...g, projectCount: gs.length, taskCount: ts.length, taskDone: done, progress: ts.length ? Math.round((done / ts.length) * 100) : 0 };
    }));
    return { goals: withProgress };
  });

  app.post("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может создавать цели" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте данные цели", detail: parsed.error.flatten().fieldErrors });
    if (parsed.data.areaId) {
      const a = await app.db.select({ id: areas.id }).from(areas).where(and(eq(areas.id, parsed.data.areaId), eq(areas.workspaceId, auth.workspaceId))).limit(1);
      if (!a[0]) return reply.code(404).send({ error: "Область жизни не найдена" });
    }
    const values = { ...parsed.data, workspaceId: auth.workspaceId, targetDate: parsed.data.targetDate ? new Date(parsed.data.targetDate) : undefined };
    const [g] = await app.db.insert(goals).values(values).returning();
    return reply.code(201).send(g);
  });

  app.get("/:id", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const rows = await app.db.select().from(goals)
      .where(and(eq(goals.id, (request.params as { id: string }).id), eq(goals.workspaceId, auth.workspaceId), isNull(goals.deletedAt))).limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "Цель не найдена" });
    const linkedProjects = await app.db.select().from(projects).where(and(eq(projects.goalId, rows[0].id)));
    return { ...rows[0], projects: linkedProjects };
  });

  app.patch("/:id", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может изменять цели" });
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте данные", detail: parsed.error.flatten().fieldErrors });
    const patch: Record<string, unknown> = { ...parsed.data, updatedAt: new Date() };
    if (parsed.data.targetDate) patch.targetDate = new Date(parsed.data.targetDate);
    const [row] = await app.db.update(goals)
      .set(patch).where(and(eq(goals.id, (request.params as { id: string }).id), eq(goals.workspaceId, auth.workspaceId)))
      .returning();
    if (!row) return reply.code(404).send({ error: "Цель не найдена" });
    return row;
  });

  app.delete("/:id", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (!["owner", "admin"].includes(auth.role)) return reply.code(403).send({ error: "Недостаточно прав" });
    const [row] = await app.db.update(goals).set({ deletedAt: new Date() })
      .where(and(eq(goals.id, (request.params as { id: string }).id), eq(goals.workspaceId, auth.workspaceId))).returning();
    if (!row) return reply.code(404).send({ error: "Цель не найдена" });
    return { ok: true };
  });
};
