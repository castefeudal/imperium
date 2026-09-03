import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { decisions, decisionOptions, decisionCriteria } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";
import { requireAuth, csrfOk } from "../plugins/auth-helpers.js";
import { and, eq } from "drizzle-orm";
import { analyzeDecision } from "@imperium/domain";

export const registerDecisionsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: decisions,
    idColumn: decisions.id,
    workspaceColumn: decisions.workspaceId,
    softDeleteColumn: undefined,
    orderBy: decisions.createdAt,
    entityName: "Решение",
    createSchema: z.object({ question: z.string().min(1).max(1000), objective: z.string().max(3000).optional(), status: z.enum(['open','analyzing','decided','expired','cancelled']).default('open'), constraints: z.string().max(5000).optional(), assumptions: z.string().max(5000).optional() }),
    updateSchema: z.object({ question: z.string().min(1).max(1000), objective: z.string().max(3000).optional(), status: z.enum(['open','analyzing','decided','expired','cancelled']).default('open'), constraints: z.string().max(5000).optional(), assumptions: z.string().max(5000).optional() }).partial(),
  }));

  app.post("/:id/analyze", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const id = (request.params as { id: string }).id;
    const owned = await app.db.select({ id: decisions.id, workspaceId: decisions.workspaceId })
      .from(decisions).where(and(eq(decisions.id, id), eq(decisions.workspaceId, auth.workspaceId))).limit(1);
    if (!owned[0]) return reply.code(404).send({ error: "Решение не найдено" });

    const parsed = z.object({
      criteria: z.array(z.object({ id: z.string().min(1), title: z.string().min(1), weight: z.number().min(0).max(1), direction: z.enum(["maximize", "minimize"]).default("maximize") })).min(1).max(20),
      options: z.array(z.object({ optionId: z.string().min(1), scores: z.record(z.string(), z.number()) })).min(2).max(10),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте критерии и оценки", detail: parsed.error.flatten().fieldErrors });

    const existingOptions = await app.db.select({ id: decisionOptions.id }).from(decisionOptions).where(eq(decisionOptions.decisionId, id));
    if (existingOptions.length === 0) {
      await app.db.insert(decisionOptions).values(parsed.data.options.map((o) => ({ decisionId: id, title: o.optionId })));
    }
    const existingCriteria = await app.db.select({ id: decisionCriteria.id }).from(decisionCriteria).where(eq(decisionCriteria.decisionId, id));
    if (existingCriteria.length === 0) {
      await app.db.insert(decisionCriteria).values(parsed.data.criteria.map((c) => ({ decisionId: id, name: c.title, weight: c.weight })));
    }

    const result = analyzeDecision(
      parsed.data.criteria.map((c) => ({ id: c.id, title: c.title, weight: c.weight, direction: c.direction })),
      parsed.data.options.map((o) => ({ optionId: o.optionId, scores: o.scores })),
    );
    await app.db.update(decisions).set({ status: "analyzing", updatedAt: new Date() }).where(eq(decisions.id, id));
    return result;
  });
};
