import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { users } from "@imperium/database";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword, createSession, ensureDefaultWorkspace, audit, sessionCookieOptions, SESSION_COOKIE } from "../plugins/auth-core.js";
import { getAuth, requireAuth } from "../plugins/auth-helpers.js";

const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(10).max(200),
  displayName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

export const registerAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post("/register", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте введённые данные", detail: parsed.error.flatten().fieldErrors });
    const { email, password, displayName } = parsed.data;
    const existing = await app.db.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    if (existing[0]) return reply.code(409).send({ error: "Пользователь с таким email уже существует" });
    const passwordHash = await hashPassword(password);
    const inserted = await app.db.insert(users).values({ email: email.toLowerCase(), passwordHash, displayName }).returning();
    const user = inserted[0];
    if (!user) return reply.code(500).send({ error: "Не удалось создать пользователя" });
    const workspaceId = await ensureDefaultWorkspace(app.db, user.id, displayName);
    await audit(app.db, { userId: user.id, workspaceId, action: "auth.register", detail: { email } });
    const session = await createSession(app.db, user.id, workspaceId, { ip: request.ip, userAgent: request.headers["user-agent"] });
    reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(30 * 24 * 3600));
    return reply.code(201).send({ csrfToken: session.csrfToken, workspaceId, userId: user.id });
  });

  app.post("/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте введённые данные" });
    const { email, password } = parsed.data;
    const rows = await app.db.select().from(users).where(eq(users.email, email.toLowerCase())).limit(1);
    const user = rows[0];
    if (!user) return reply.code(401).send({ error: "Неверный email или пароль" });
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) return reply.code(401).send({ error: "Неверный email или пароль" });
    const workspaceId = await ensureDefaultWorkspace(app.db, user.id, user.displayName ?? "user");
    await audit(app.db, { userId: user.id, workspaceId, action: "auth.login", detail: { email } });
    const session = await createSession(app.db, user.id, workspaceId, { ip: request.ip, userAgent: request.headers["user-agent"] });
    reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(30 * 24 * 3600));
    return { csrfToken: session.csrfToken, workspaceId, userId: user.id };
  });

  app.post("/logout", async (request, reply) => {
    const auth = await getAuth(request, app.db);
    if (auth) {
      await audit(app.db, { userId: auth.userId, workspaceId: auth.workspaceId, action: "auth.logout" });
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/me", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const rows = await app.db.select({ id: users.id, email: users.email, displayName: users.displayName, locale: users.locale, timezone: users.timezone })
      .from(users).where(eq(users.id, auth.userId)).limit(1);
    return { user: rows[0] ?? null, workspaceId: auth.workspaceId, role: auth.role, csrfToken: auth.csrfToken };
  });
};
