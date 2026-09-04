import Fastify from "fastify";
import { ModelRouter, type ProviderCredentials } from "@imperium/ai";
import { registerGatewayRoutes } from "./routes/gateway.js";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import helmet from "@fastify/helmet";
import { getDb } from "./plugins/db.js";
import { registerAudit } from "./plugins/audit.js";
import { requireAuth } from "./plugins/auth-helpers.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerWorkspacesRoutes } from "./routes/workspaces.js";
import { registerNotesRoutes } from "./routes/notes.js";
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
import { registerApiKeysRoutes } from "./routes/api-keys.js";
import type { FastifyError } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    db: ReturnType<typeof getDb>;
    modelRouter: import("@imperium/ai").ModelRouter;
    requireAuth(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply): Promise<import("./plugins/auth-helpers.js").AuthContext | null>;
  }
  interface FastifyRequest {
    auth?: import("./plugins/auth-helpers.js").AuthContext;
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

  registerAudit(app);

  // Model router: реальные провайдеры из env, test-provider только для dev/test.
  const gatewayCredentials: ProviderCredentials[] = [];
  const addCred = (id: string, kind: ProviderCredentials["kind"], envKey?: string, baseUrl?: string) => {
    if (kind === "test") {
      if (process.env.NODE_ENV !== "production") gatewayCredentials.push({ id, kind, label: "Deterministic test provider" });
      return;
    }
    const apiKey = envKey ? process.env[envKey] : undefined;
    if (apiKey || (kind === "openai-compatible" && !envKey)) {
      gatewayCredentials.push({ id, kind, label: id, apiKey, baseUrl });
    }
  };
  addCred("openai", "openai-compatible", "OPENAI_API_KEY", "https://api.openai.com/v1");
  addCred("openrouter", "openai-compatible", "OPENROUTER_API_KEY", "https://openrouter.ai/api/v1");
  addCred("ollama", "openai-compatible", undefined, process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1");
  addCred("anthropic", "anthropic", "ANTHROPIC_API_KEY");
  addCred("google", "google", "GOOGLE_AI_API_KEY");
  addCred("test", "test");
  const modelRouter = new ModelRouter({ credentials: gatewayCredentials });
  app.modelRouter = modelRouter;

  app.requireAuth = ((request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) =>
    requireAuth(app, request, reply)) as typeof app.requireAuth;

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
  await app.register(registerNotesRoutes, { prefix: "/api/v1/notes" });
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
  await app.register(registerApiKeysRoutes, { prefix: "/api/v1/api-keys" });
  await app.register(registerGatewayRoutes, { prefix: "/v1" });

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
