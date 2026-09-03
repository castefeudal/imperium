import type { FastifyInstance } from "fastify";
import type { Db } from "./db.js";
import { auditLogs } from "@imperium/database";

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string;
  diff?: { from?: unknown; to?: unknown };
  detail?: Record<string, unknown>;
}

export interface AuditActor {
  userId: string;
  workspaceId: string;
  ip?: string;
  userAgent?: string;
}

/** Низкоуровневая запись аудит-события. Ошибка логируется, но не ломает мутацию. */
export async function writeAudit(db: Db, actor: AuditActor, entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      workspaceId: actor.workspaceId,
      userId: actor.userId,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      diff: entry.diff ?? undefined,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
      meta: entry.detail ?? {},
    });
  } catch (e) {
    // Аудит не должен ломать пользовательскую мутацию, но сбой не теряется бесследно.
    console.error("[audit] запись не удалась", { action: entry.action, error: e instanceof Error ? e.message : String(e) });
  }
}

export function registerAudit(app: FastifyInstance): void {
  app.decorate("audit", (actor: AuditActor, entry: AuditEntry) => writeAudit(app.db, actor, entry));
}

declare module "fastify" {
  interface FastifyInstance {
    audit(actor: AuditActor, entry: AuditEntry): Promise<void>;
  }
}
