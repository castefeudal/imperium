import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireAuth } from "../plugins/auth-helpers.js";

export const registerSearchRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { q?: string; kind?: string; limit?: string } }>("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const parsed = z.object({ q: z.string().min(1).max(500), limit: z.coerce.number().int().min(1).max(50).default(20) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте параметры поиска" });
    const { q, limit } = parsed.data;
    return { query: q, results: [], count: 0, note: "Поисковый индекс не настроен — подключите провайдера поиска" };
  });
};
