import type { FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sessions, workspaceMembers } from "@imperium/database";
import { SESSION_COOKIE } from "./auth-core.js";
import type { Db } from "./db.js";

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: string;
  csrfToken: string;
  sessionId: string;
}

export async function getAuth(request: FastifyRequest, db: Db): Promise<AuthContext | null> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const crypto = await import("node:crypto");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
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
    csrfToken: session.csrfToken,
    sessionId: session.id,
  };
}

export function csrfOk(request: FastifyRequest, auth: AuthContext): boolean {
  const header = request.headers["x-csrf-token"];
  return typeof header === "string" && header === auth.csrfToken;
}

import type { FastifyReply, FastifyInstance } from "fastify";

/** App-first guard: replies 401 and returns null when unauthenticated. */
export async function requireAuth(
  app: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const auth = await getAuth(request, app.db);
  if (!auth) {
    reply.code(401).send({ error: "Требуется вход в систему" });
    return null;
  }
  return auth;
}
