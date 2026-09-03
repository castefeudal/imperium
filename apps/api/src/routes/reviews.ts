import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { reviews as reviewsTable } from "@imperium/database";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth, csrfOk } from "../plugins/auth-helpers.js";

const createSchema = z.object({
  kind: z.enum(["daily", "weekly", "monthly"]),
  periodStart: z.string().datetime().optional(),
  achievement: z.string().max(2000).optional(),
  mood: z.number().int().min(1).max(5).optional(),
  planned: z.record(z.unknown()).optional(),
  done: z.record(z.unknown()).optional(),
  next: z.record(z.unknown()).optional(),
});

export const registerReviewsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const kind = (request.query as { kind?: string }).kind;
    const conditions = [eq(reviewsTable.workspaceId, auth.workspaceId)];
    if (kind) conditions.push(eq(reviewsTable.kind, kind));
    const rows = await app.db.select().from(reviewsTable).where(and(...conditions)).orderBy(desc(reviewsTable.createdAt)).limit(50);
    return { reviews: rows };
  });

  app.post("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может создавать обзоры" });
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте данные обзора", details: parsed.error.flatten().fieldErrors });
    const [row] = await app.db.insert(reviewsTable).values({
      workspaceId: auth.workspaceId,
      ...parsed.data,
      periodStart: parsed.data.periodStart ? new Date(parsed.data.periodStart) : new Date(),
    }).returning();
    return reply.code(201).send(row);
  });
};
