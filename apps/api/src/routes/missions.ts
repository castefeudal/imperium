import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { missions, missionSteps, agentRuns, toolCalls, approvals, costLedger, projects } from "@imperium/database";
import { and, desc, eq, inArray } from "drizzle-orm";

import { requireAuth, csrfOk } from "../plugins/auth-helpers.js";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import type { MissionStatus } from "@imperium/domain";
import { canTransition } from "@imperium/domain";

const createSchema = z.object({
  title: z.string().min(1).max(200),
  objective: z.string().min(1).max(5000),
  projectId: z.string().uuid().nullable().optional(),
  priority: z.number().int().min(1).max(5).optional(),
  maxSteps: z.number().int().min(1).max(200).optional(),
  deadline: z.string().datetime().nullable().optional(),
  allowedTools: z.array(z.string().max(100)).optional(),
  context: z.record(z.unknown()).optional(),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(["draft", "planning", "awaiting_approval", "queued", "running", "blocked", "reviewing", "completed", "failed", "cancelled"]).optional(),
});

export const registerMissionsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { status?: string } }>("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const status = request.query.status;
    const conditions = [eq(missions.workspaceId, auth.workspaceId)];
    if (status) conditions.push(eq(missions.status, status));
    const rows = await app.db.select().from(missions).where(and(...conditions)).orderBy(desc(missions.createdAt)).limit(100);
    return { missions: rows };
  });

  app.post("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может создавать миссии" });
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте данные миссии", detail: parsed.error.flatten().fieldErrors });
    const d = parsed.data;
    if (d.projectId) {
      const p = await app.db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, d.projectId), eq(projects.workspaceId, auth.workspaceId))).limit(1);
      if (!p[0]) return reply.code(400).send({ error: "Проект не найден в этом рабочем пространстве" });
    }
    const [m] = await app.db.insert(missions).values({
      workspaceId: auth.workspaceId,
      title: d.title,
      objective: d.objective,
      projectId: d.projectId ?? null,
      priority: d.priority ?? 3,
      maxSteps: d.maxSteps ?? 50,
      deadline: d.deadline ? new Date(d.deadline) : null,
      allowedTools: d.allowedTools ?? [],
      context: d.context ?? {},
      createdBy: auth.userId,
      status: "draft",
    }).returning();
    if (!m) return reply.code(500).send({ error: "Не удалось создать миссию" });
    app.audit(auth, { action: "mission.created", entity: "mission", entityId: m.id, detail: { title: m.title } });
    return reply.code(201).send(m);
  });

  app.get("/:id", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const id = (request.params as { id: string }).id;
    const rows = await app.db.select().from(missions).where(and(eq(missions.id, id), eq(missions.workspaceId, auth.workspaceId))).limit(1);
    if (!rows[0]) return reply.code(404).send({ error: "Миссия не найдена" });
    const steps = await app.db.select().from(missionSteps).where(eq(missionSteps.missionId, id)).orderBy(missionSteps.startedAt);
    const runs = await app.db.select().from(agentRuns).where(eq(agentRuns.missionId, id)).orderBy(desc(agentRuns.startedAt));
    const calls = await app.db.select().from(toolCalls).where(eq(toolCalls.missionId, id)).orderBy(desc(toolCalls.createdAt)).limit(50);
    const pending = await app.db.select().from(approvals).where(and(eq(approvals.missionId, id), eq(approvals.status, "pending")));
    const costs = await app.db.select().from(costLedger).where(eq(costLedger.missionId, id));
    const costUsd = costs.reduce((s, c) => s + Number(c.estCostUsd ?? 0), 0);
    return { mission: rows[0], steps, runs, toolCalls: calls, pendingApprovals: pending, costUsd };
  });

  app.patch("/:id", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может изменять миссии" });
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const id = (request.params as { id: string }).id;
    const current = (await app.db.select().from(missions).where(and(eq(missions.id, id), eq(missions.workspaceId, auth.workspaceId))).limit(1))[0];
    if (!current) return reply.code(404).send({ error: "Миссия не найдена" });
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте данные", detail: parsed.error.flatten().fieldErrors });
    const { status, ...fields } = parsed.data;
    if (status && status !== current.status && !canTransition(current.status as MissionStatus, status)) {
      return reply.code(409).send({ error: `Недопустимый переход статуса: ${current.status} → ${status}` });
    }
    const patch: Record<string, unknown> = { ...fields };
    if (status) {
      patch.status = status;
      if (status === "completed") patch.completedAt = new Date();
      if (status === "running" && !current.startedAt) patch.startedAt = new Date();
    }
    const [m] = await app.db.update(missions).set(patch).where(eq(missions.id, id)).returning();
    app.audit(auth, { action: "mission.updated", entity: "mission", entityId: id, diff: { from: { status: current.status }, to: { status: status ?? current.status } } });
    return m;
  });

  app.post("/:id/run", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может запускать миссии" });
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const id = (request.params as { id: string }).id;
    const current = (await app.db.select().from(missions).where(and(eq(missions.id, id), eq(missions.workspaceId, auth.workspaceId))).limit(1))[0];
    if (!current) return reply.code(404).send({ error: "Миссия не найдена" });
    if (!canTransition(current.status as MissionStatus, "queued")) {
      return reply.code(409).send({ error: `Миссия в статусе ${current.status} не может быть поставлена в очередь` });
    }
    const [run] = await app.db.insert(agentRuns).values({
      missionId: id,
      workspaceId: auth.workspaceId,
      status: "queued",
      maxSteps: current.maxSteps,
      idempotencyKey: `run:${randomUUID()}`,
    }).returning();
    if (!run) return reply.code(500).send({ error: "Не удалось создать запуск" });
    // Если у миссии ещё нет шагов — создаём стартовый шаг из цели миссии,
    // чтобы воркер всегда имел хотя бы одну единицу работы.
    const existingSteps = await app.db.select({ id: missionSteps.id }).from(missionSteps).where(eq(missionSteps.missionId, id)).limit(1);
    if (existingSteps.length === 0) {
      await app.db.insert(missionSteps).values({
        missionId: id,
        title: current.title,
        description: current.objective,
        status: "ready",
      });
    }
    const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379", { lazyConnect: false, maxRetriesPerRequest: 1 });
    try {
      await redis.lpush("imperium:missions:queue", run.id);
    } catch (e) {
      app.log.error({ err: e }, "не удалось поставить запуск в очередь");
      await app.db.update(agentRuns).set({ status: "failed", error: "Очередь недоступна" }).where(eq(agentRuns.id, run.id));
      return reply.code(503).send({ error: "Очередь задач недоступна, попробуйте позже" });
    } finally {
      redis.disconnect();
    }
    await app.db.update(missions).set({ status: "queued", startedAt: current.startedAt ?? new Date() }).where(eq(missions.id, id));
    app.audit(auth, { action: "mission.queued", entity: "mission", entityId: id, detail: { runId: run.id } });
    return reply.code(202).send({ runId: run.id, status: "queued" });
  });

  app.post("/:id/cancel", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const id = (request.params as { id: string }).id;
    const current = (await app.db.select().from(missions).where(and(eq(missions.id, id), eq(missions.workspaceId, auth.workspaceId))).limit(1))[0];
    if (!current) return reply.code(404).send({ error: "Миссия не найдена" });
    if (!canTransition(current.status as MissionStatus, "cancelled")) return reply.code(409).send({ error: `Миссия в статусе ${current.status} не может быть отменена` });
    const [m] = await app.db.update(missions).set({ status: "cancelled" }).where(eq(missions.id, id)).returning();
    await app.db.update(missionSteps).set({ status: "cancelled" }).where(and(eq(missionSteps.missionId, id), inArray(missionSteps.status, ["pending", "running", "awaiting_approval"])));
    app.audit(auth, { action: "mission.cancelled", entity: "mission", entityId: id });
    return m;
  });

  app.post("/:id/approve/:approvalId", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const { id, approvalId } = request.params as { id: string; approvalId: string };
    const body = z.object({ decision: z.enum(["allow_once", "allow_mission", "reject"]) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Укажите решение: allow_once, allow_mission или reject" });
    const rows = await app.db.select().from(approvals).where(and(eq(approvals.id, approvalId), eq(approvals.missionId, id), eq(approvals.workspaceId, auth.workspaceId))).limit(1);
    const approval = rows[0];
    if (!approval) return reply.code(404).send({ error: "Запрос на подтверждение не найден" });
    if (approval.status !== "pending") return reply.code(409).send({ error: "Запрос уже обработан" });
    if (approval.expiresAt && approval.expiresAt.getTime() < Date.now()) {
      await app.db.update(approvals).set({ status: "expired" }).where(eq(approvals.id, approvalId));
      return reply.code(410).send({ error: "Срок подтверждения истёк — запросите действие заново" });
    }
    const decision = body.data.decision === "reject" ? "rejected"
      : body.data.decision === "allow_mission" ? "approved_for_mission"
      : "approved_once";
    const [a] = await app.db.update(approvals).set({ status: decision, decidedBy: auth.userId, decidedAt: new Date() }).where(eq(approvals.id, approvalId)).returning();
    app.audit(auth, { action: `approval.${decision}`, entity: "approval", entityId: approvalId, detail: { approval: approval.title, kind: approval.kind, missionId: id } });
    return a;
  });
};
