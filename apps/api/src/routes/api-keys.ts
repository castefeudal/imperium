import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { apiKeys } from "@imperium/database";
import {
  SCOPES,
  csrfOk,
  generateApiKey,
  requireAuth,
  requireScope,
} from "../plugins/auth-helpers.js";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(SCOPES)).min(1).max(10),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});

/** Управление API-ключами (machine auth для Hermes/MCP/скриптов). */
export const registerApiKeysRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (!requireScope(auth, "admin", reply)) return;
    const rows = await app.db.select({
      id: apiKeys.id,
      name: apiKeys.name,
      keyPreview: apiKeys.keyPreview,
      scopes: apiKeys.scopes,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    }).from(apiKeys)
      .where(and(eq(apiKeys.workspaceId, auth.workspaceId), isNull(apiKeys.revokedAt)))
      .orderBy(desc(apiKeys.createdAt))
      .limit(200);
    return { keys: rows };
  });

  app.post("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (!requireScope(auth, "admin", reply)) return;
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Проверьте данные", detail: parsed.error.flatten().fieldErrors });
    }
    const { name, scopes, expiresInDays } = parsed.data;
    const { full, hash, preview } = generateApiKey();
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
    const [row] = await app.db.insert(apiKeys).values({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      name,
      scopes,
      keyHash: hash,
      keyPreview: preview,
      expiresAt,
    }).returning({ id: apiKeys.id, keyPreview: apiKeys.keyPreview, scopes: apiKeys.scopes, expiresAt: apiKeys.expiresAt, createdAt: apiKeys.createdAt });
    if (!row) return reply.code(500).send({ error: "Не удалось создать ключ" });
    app.audit(auth, { action: "api_key.created", entity: "api_key", entityId: row.id, detail: { name, scopes } });
    // Полный ключ показывается один раз — в этом ответе. В БД только sha256-хеш.
    return reply.code(201).send({ key: full, ...row });
  });

  app.delete("/:id", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (!requireScope(auth, "admin", reply)) return;
    if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
    const id = (request.params as { id: string }).id;
    const [row] = await app.db.update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, auth.workspaceId), isNull(apiKeys.revokedAt)))
      .returning({ id: apiKeys.id, name: apiKeys.name });
    if (!row) return reply.code(404).send({ error: "Ключ не найден" });
    app.audit(auth, { action: "api_key.revoked", entity: "api_key", entityId: id, detail: { name: row.name } });
    return { ok: true };
  });
};
