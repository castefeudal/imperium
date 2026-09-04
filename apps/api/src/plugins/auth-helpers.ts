import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, or, gt } from "drizzle-orm";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { apiKeys, sessions, workspaceMembers } from "@imperium/database";
import { SESSION_COOKIE } from "./auth-core.js";
import type { Db } from "./db.js";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: string;
  /** session = браузер (cookie+CSRF), api_key = machine-клиент (Bearer) */
  authType: "session" | "api_key";
  /** CSRF-токен (только для session; у api_key пустая строка) */
  csrfToken: string;
  /** id сессии (только для session) */
  sessionId: string;
  /** id ключа, если авторизация по API-ключу */
  apiKeyId?: string;
  /** null = полный доступ (сессия); иначе список scopes ключа */
  scopes: string[] | null;
}

// ── Scopes ─────────────────────────────────────────────────────────
export const SCOPES = [
  "read",
  "write",
  "admin",
  "missions:execute",
] as const;
export type Scope = (typeof SCOPES)[number];

/** Проверяет, что контекст авторизации даёт доступ с нужным scope.
 *  Сессия = полный доступ. API-ключ требует наличие scope (или admin). */
export function scopeAllows(auth: AuthContext, needed: "read" | "write" | "admin" | "missions:execute"): boolean {
  if (auth.authType === "session") return true;
  if (!auth.scopes) return false;
  if (auth.scopes.includes("admin")) return true;
  if (needed === "read") return auth.scopes.includes("read") || auth.scopes.includes("write");
  if (needed === "write") return auth.scopes.includes("write");
  return auth.scopes.includes(needed);
}

// ── Генерация и хеширование ключей ─────────────────────────────────
const KEY_PREFIX = "imp_";

export function generateApiKey(): { full: string; hash: string; preview: string } {
  const secret = randomBytes(32).toString("base64url");
  const full = `${KEY_PREFIX}${secret}`;
  return { full, hash: hashApiKey(full), preview: `${KEY_PREFIX}${secret.slice(0, 6)}…${secret.slice(-4)}` };
}

export function hashApiKey(full: string): string {
  return createHash("sha256").update(full).digest("hex");
}

export function isApiKeyShape(token: string): boolean {
  return token.startsWith(KEY_PREFIX) && token.length > KEY_PREFIX.length + 16;
}

export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(imp_[A-Za-z0-9_-]+)$/i.exec(header.trim());
  const token = m?.[1];
  return typeof token === "string" && token.length > 4 ? token : null;
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

// ── Bearer auth (machine clients) ──────────────────────────────────
async function getApiKeyAuth(token: string, db: Db): Promise<AuthContext | null> {
  if (!isApiKeyShape(token)) return null;
  const hash = hashApiKey(token);
  const now = new Date();
  const rows = await db.select().from(apiKeys)
    .where(and(
      eq(apiKeys.keyHash, hash),
      isNull(apiKeys.revokedAt),
      or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now)),
    ))
    .limit(1);
  const key = rows[0];
  if (!key || !safeEqualHex(key.keyHash, hash)) return null;

  // Владелец ключа: сохранённый userId, иначе owner воркспейса (fallback для legacy-ключей)
  let userId = key.userId;
  if (!userId) {
    const owner = await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, key.workspaceId), eq(workspaceMembers.role, "owner")))
      .limit(1);
    userId = owner[0]?.userId ?? null;
  }
  if (!userId) return null;

  // fire-and-forget отметка использования; никогда не блокирует auth
  void db.update(apiKeys).set({ lastUsedAt: now }).where(eq(apiKeys.id, key.id)).catch(() => {});

  return {
    userId,
    workspaceId: key.workspaceId,
    role: "member",
    authType: "api_key",
    csrfToken: "",
    sessionId: "",
    apiKeyId: key.id,
    scopes: (key.scopes as string[] | null) ?? [],
  };
}

// ── Единая точка: bearer → session ─────────────────────────────────
export async function getAuth(request: FastifyRequest, db: Db): Promise<AuthContext | null> {
  // 1) Machine client: Authorization: Bearer imp_...
  const bearer = extractBearerToken(request.headers.authorization);
  if (bearer) return getApiKeyAuth(bearer, db);

  // 2) Браузер: session cookie
  const cookie = request.cookies[SESSION_COOKIE];
  if (!cookie) return null;
  const tokenHash = hashApiKey(cookie);
  const rows = await db.select().from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  const session = rows[0];
  if (!session) return null;
  const memberRows = await db.select().from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, session.userId), eq(workspaceMembers.workspaceId, session.workspaceId!)))
    .limit(1);
  const member = memberRows[0];
  return {
    userId: session.userId,
    workspaceId: session.workspaceId!,
    role: member?.role ?? "viewer",
    authType: "session",
    csrfToken: session.csrfToken,
    sessionId: session.id,
    scopes: null,
  };
}

export function csrfOk(request: FastifyRequest, auth: AuthContext): boolean {
  // Machine-клиенты с API-ключом не используют CSRF (ключ — proof of possession)
  if (auth.authType === "api_key") return true;
  const header = request.headers["x-csrf-token"];
  return typeof header === "string" && header === auth.csrfToken;
}

/** App-first guard: отвечает 401 и возвращает null, когда нет доступа. */
export async function requireAuth(
  a: FastifyInstance | FastifyRequest,
  b: FastifyRequest | FastifyReply,
  c?: FastifyReply,
): Promise<AuthContext | null> {
  // Поддерживает прямой вызов requireAuth(app, request, reply)
  // и preHandler { preHandler: [app.requireAuth] } через обёртку в index.ts.
  const direct = "db" in a;
  const app = (direct ? a : (a as unknown as { requireAuthApp?: FastifyInstance }).requireAuthApp)! as FastifyInstance;
  const request = (direct ? b : a) as FastifyRequest;
  const reply = (direct ? c! : b) as FastifyReply;
  const auth = await getAuth(request, app.db);
  request.auth = auth ?? undefined;
  if (!auth) {
    reply.code(401).send({ error: "Требуется вход в систему" });
    return null;
  }
  return auth;
}

/** App-first scope guard: отвечает 403 и возвращает false, когда scope не даёт доступ. */
export function requireScope(
  auth: AuthContext,
  needed: "read" | "write" | "admin" | "missions:execute",
  reply: FastifyReply,
): boolean {
  if (scopeAllows(auth, needed)) return true;
  void reply.code(403).send({ error: "Недостаточно прав (scope)", requiredScope: needed });
  return false;
}
