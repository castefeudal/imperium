import crypto from "node:crypto";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import { sessions, users, workspaces, workspaceMembers, auditLogs } from "@imperium/database";
import type { Db } from "./db.js";

export const SESSION_COOKIE = "imperium_session";
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function csrfToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function sessionCookieOptions(maxAgeSec: number) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    maxAge: maxAgeSec,
  };
}

export async function createSession(db: Db, userId: string, workspaceId: string, meta: { ip?: string; userAgent?: string | string[] }) {
  const token = newSessionToken();
  const csrf = csrfToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    userId,
    workspaceId,
    tokenHash: hashToken(token),
    csrfToken: csrf,
    ip: meta.ip,
    userAgent: Array.isArray(meta.userAgent) ? meta.userAgent.join(" ") : meta.userAgent,
    expiresAt,
  });
  return { token, csrfToken: csrf, expiresAt };
}

export async function ensureDefaultWorkspace(db: Db, userId: string, displayName: string): Promise<string> {
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const base = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
  const slug = `${base}-${crypto.randomBytes(3).toString("hex")}`;
  const wsRows = await db.insert(workspaces).values({ name: displayName, slug, ownerId: userId }).returning();
  const ws = wsRows[0];
  if (!ws) throw new Error("Не удалось создать рабочее пространство");
  await db.insert(workspaceMembers).values({ workspaceId: ws.id, userId, role: "owner" });
  return ws.id;
}

export async function audit(db: Db, entry: { userId: string; workspaceId: string; action: string; detail?: Record<string, unknown> }) {
  await db.insert(auditLogs).values({
    workspaceId: entry.workspaceId,
    userId: entry.userId,
    action: entry.action,
    meta: entry.detail ?? {},
  });
}
