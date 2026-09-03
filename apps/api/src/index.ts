import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { getDb } from "./plugins/db.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerWorkspacesRoutes } from "./routes/workspaces.js";
import { registerGoalsRoutes } from "./routes/goals.js";
import { registerProjectsRoutes } from "./routes/projects.js";
import { registerTasksRoutes } from "./routes/tasks.js";
import { registerMissionsRoutes } from "./routes/missions.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerKnowledgeRoutes } from "./routes/knowledge.js";
import { registerEvidenceRoutes } from "./routes/evidence.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerCreatorRoutes } from "./routes/creator.js";
import { registerDecisionsRoutes } from "./routes/decisions.js";
import { registerExperimentsRoutes } from "./routes/experiments.js";
import { registerAutomationsRoutes } from "./routes/automations.js";
import { registerInboxRoutes } from "./routes/inbox.js";
import { registerIntegrationsRoutes } from "./routes/integrations.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerPeopleRoutes } from "./routes/people.js";
import { registerReviewsRoutes } from "./routes/reviews.js";
import type { FastifyError } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof getDb>;
    requireAuth(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply): Promise<import("./plugins/auth-helpers.js").AuthContext | null>;
  }
}

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? {
      level: process.env.LOG_LEVEL ?? "info",
      redact: ["req.headers.authorization", "req.headers.cookie"],
    },
    trustProxy: true,
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: process.env.CORS_ORIGIN?.split(",") ?? ["http://localhost:3000"], credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.db = getDb();

  app.requireAuth = async (request, reply) => {
    const { getAuth } = await import("./plugins/auth-helpers.js");
    const auth = await getAuth(request, app.db);
    if (!auth) {
      reply.code(401).send({ error: "Требуется вход в систему" });
      return null;
    }
    return auth;
  };

  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));
  app.get("/ready", async (_req, reply) => {
    try {
      await app.db.execute("SELECT 1");
      return { ready: true };
    } catch {
      return reply.code(503).send({ ready: false });
    }
  });

  await app.register(registerAuthRoutes, { prefix: "/api/v1/auth" });
  await app.register(registerWorkspacesRoutes, { prefix: "/api/v1/workspaces" });
  await app.register(registerGoalsRoutes, { prefix: "/api/v1/goals" });
  await app.register(registerProjectsRoutes, { prefix: "/api/v1/projects" });
  await app.register(registerTasksRoutes, { prefix: "/api/v1/tasks" });
  await app.register(registerMissionsRoutes, { prefix: "/api/v1/missions" });
  await app.register(registerMemoryRoutes, { prefix: "/api/v1/memory" });
  await app.register(registerKnowledgeRoutes, { prefix: "/api/v1/knowledge" });
  await app.register(registerEvidenceRoutes, { prefix: "/api/v1/evidence" });
  await app.register(registerHealthRoutes, { prefix: "/api/v1/health" });
  await app.register(registerCreatorRoutes, { prefix: "/api/v1/creator" });
  await app.register(registerDecisionsRoutes, { prefix: "/api/v1/decisions" });
  await app.register(registerExperimentsRoutes, { prefix: "/api/v1/experiments" });
  await app.register(registerAutomationsRoutes, { prefix: "/api/v1/automations" });
  await app.register(registerInboxRoutes, { prefix: "/api/v1/inbox" });
  await app.register(registerIntegrationsRoutes, { prefix: "/api/v1/integrations" });
  await app.register(registerSearchRoutes, { prefix: "/api/v1/search" });
  await app.register(registerSettingsRoutes, { prefix: "/api/v1/settings" });
  await app.register(registerPeopleRoutes, { prefix: "/api/v1/people" });
  await app.register(registerReviewsRoutes, { prefix: "/api/v1/reviews" });

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) app.log.error({ err }, "request failed");
    reply.code(status).send({
      error: status < 500 ? err.message : "Внутренняя ошибка сервера",
      statusCode: status,
    });
  });

  return app;
}

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isDirectRun) {
  buildApp()
    .then(async (app) => {
      const port = Number(process.env.PORT ?? 4000);
      await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
      console.log(`API запущен на порту ${port}`);
    })
    .catch((e) => {
      console.error("Не удалось запустить API:", e);
      process.exit(1);
    });
}
