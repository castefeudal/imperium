import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { users } from "@imperium/database";
import { eq } from "drizzle-orm";
import { requireAuth, csrfOk } from "../plugins/auth-helpers.js";

export const registerSettingsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const rows = await app.db.select({
      locale: users.locale,
      timezone: users.timezone,
      displayName: users.displayName,
    }).from(users).where(eq(users.id, auth.userId)).limit(1);
    return { settings: rows[0] ?? null };
  });

  app.patch("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может изменять настройки" });
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const parsed = z.object({
      locale: z.string().max(10).optional(),
      timezone: z.string().max(60).optional(),
      displayName: z.string().max(200).optional(),
    }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте параметры настроек" });
    const [row] = await app.db.update(users).set({ ...parsed.data, updatedAt: new Date() }).where(eq(users.id, auth.userId)).returning({ locale: users.locale, timezone: users.timezone, displayName: users.displayName });
    return { settings: row ?? null };
  });
};
