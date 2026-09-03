import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import { integrationCredentials, integrations } from "@imperium/database";

const INTEGRATION_KINDS = [
  "github", "telegram", "gmail", "google_calendar", "ticktick", "notion", "mcp", "webhook", "openai_compatible",
] as const;
type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

function encryptToken(plaintext: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) throw new Error("ENCRYPTION_KEY не настроен (нужен 64 hex-символа = 32 байта)");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), enc.toString("base64")].join(":");
}

function decryptToken(payload: string): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key || key.length !== 64) throw new Error("ENCRYPTION_KEY не настроен");
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Повреждённый шифротекст");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "hex"), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

const connectSchema = z.object({
  kind: z.enum(INTEGRATION_KINDS),
  label: z.string().min(1).max(100).optional(),
  token: z.string().min(1),
  baseUrl: z.string().url().optional(),
  scopes: z.array(z.string()).default([]),
});

export const registerIntegrationsRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", { preHandler: [app.requireAuth] }, async (request) => {
    const auth = request.auth!;
    const rows = await app.db
      .select({
        id: integrations.id, kind: integrations.kind, label: integrations.label,
        status: integrations.status, lastSyncAt: integrations.lastSyncAt,
        error: integrations.error, createdAt: integrations.createdAt,
      })
      .from(integrations)
      .where(eq(integrations.workspaceId, auth.workspaceId))
      .orderBy(desc(integrations.createdAt));
    return { items: rows };
  });

  app.post("/connect", { preHandler: [app.requireAuth] }, async (request, reply) => {
    const auth = request.auth!;
    const parsed = connectSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: "VALIDATION_ERROR", message: "Проверьте kind, token и scopes", details: parsed.error.flatten() },
      });
    }
    const { kind, label, token, baseUrl, scopes } = parsed.data;
    const existing = await app.db.select({ id: integrations.id }).from(integrations)
      .where(and(eq(integrations.workspaceId, auth.workspaceId), eq(integrations.kind, kind))).limit(1);
    const encrypted = encryptToken(token);
    if (existing[0]) {
      await app.db.insert(integrationCredentials).values({
        integrationId: existing[0].id, label: label ?? kind, provider: kind,
        encryptedToken: encrypted, baseUrl, scopes, status: "active",
      });
      await app.db.update(integrations).set({ status: "connected", error: null, lastSyncAt: new Date() })
        .where(eq(integrations.id, existing[0].id));
      return { ok: true, kind, reconnected: true };
    }
    const [created] = await app.db.insert(integrations).values({
      workspaceId: auth.workspaceId, kind, label: label ?? kind, status: "connected",
      permissions: scopes, config: baseUrl ? { baseUrl } : {},
    }).returning({ id: integrations.id });
    if (!created) return reply.code(500).send({ error: "Не удалось создать интеграцию" });
    await app.db.insert(integrationCredentials).values({
      integrationId: created.id, label: label ?? kind, provider: kind,
      encryptedToken: encrypted, baseUrl, scopes, status: "active",
    });
    return reply.code(201).send({ ok: true, kind, id: created.id });
  });

  app.post("/:id/disconnect", { preHandler: [app.requireAuth] }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = request.params as { id: string };
    const rows = await app.db.select().from(integrations)
      .where(and(eq(integrations.id, id), eq(integrations.workspaceId, auth.workspaceId))).limit(1);
    if (!rows[0]) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Интеграция не найдена" } });
    await app.db.update(integrations).set({ status: "disconnected" }).where(eq(integrations.id, id));
    return { ok: true, id, status: "disconnected" };
  });

  app.post("/:id/sync", { preHandler: [app.requireAuth] }, async (request, reply) => {
    const auth = request.auth!;
    const { id } = request.params as { id: string };
    const rows = await app.db.select().from(integrations)
      .where(and(eq(integrations.id, id), eq(integrations.workspaceId, auth.workspaceId))).limit(1);
    const it = rows[0];
    if (!it) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Интеграция не найдена" } });
    if (it.status !== "connected") {
      return reply.code(409).send({ error: { code: "NOT_CONNECTED", message: "Интеграция не подключена" } });
    }
    const creds = await app.db.select().from(integrationCredentials)
      .where(eq(integrationCredentials.integrationId, id)).orderBy(desc(integrationCredentials.createdAt)).limit(1);
    if (!creds[0]) return reply.code(404).send({ error: { code: "NO_CREDENTIALS", message: "Нет сохранённых учётных данных" } });
    try { decryptToken(creds[0].encryptedToken); } catch {
      return reply.code(422).send({ error: { code: "BAD_TOKEN", message: "Не удалось расшифровать токен — проверьте ENCRYPTION_KEY" } });
    }
    await app.db.update(integrations).set({ lastSyncAt: new Date() }).where(eq(integrations.id, id));
    return { ok: true, id, syncedAt: new Date().toISOString() };
  });
};
