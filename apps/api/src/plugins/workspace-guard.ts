import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { and, eq, gt, isNull } from "drizzle-orm";
import { sessions, users, workspaceMembers, workspaces } from "@imperium/database";
import type { Db } from "./db.js";

export const SESSION_COOKIE = "imperium_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export interface AuthContext {
  userId: string;
  workspaceId: string;
  role: "owner" | "admin" | "member" | "viewer";
  db: Db;
}

const ROLE_RANK = { viewer: 0, member: 1, admin: 2, owner: 3 } as const;
export type Role = keyof typeof ROLE_RANK;

export function requireRole(ctx: AuthContext, min: Role): void {
  if (ROLE_RANK[ctx.role] < ROLE_RANK[min]) {
    const err = new Error("Недостаточно прав") as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
}

export function newSessionToken(): string {
  return crypto.randomUUID() + "." + crypto.randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Validates the session cookie and returns the authenticated user id, or null. */
export async function resolveUserId(db: Db, req: FastifyRequest): Promise<string | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return null;
  const rows = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.tokenHash, hashToken(token)),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
      isNull(users.deletedAt),
    ))
    .limit(1);
  return rows[0]?.userId ?? null;
}

/** Loads the workspace and the caller's role, enforcing tenant isolation. */
export async function resolveWorkspaceOrThrow(db: Db, userId: string, workspaceId: string) {
  const [ws] = await db.select().from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), isNull(workspaces.deletedAt)))
    .limit(1);
  if (!ws) {
    const err = new Error("Рабочее пространство не найдено") as Error & { statusCode: number };
    err.statusCode = 404;
    throw err;
  }
  const [member] = await db.select().from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!member) {
    const err = new Error("Нет доступа к рабочему пространству") as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  }
  return { workspace: ws, role: member.role as Role };
}
