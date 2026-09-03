import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { workspaces, workspaceMembers } from "@imperium/database";
import { and, eq, isNull } from "drizzle-orm";
import { requireAuth } from "../plugins/auth-helpers.js";
import { resolveWorkspaceOrThrow } from "../plugins/workspace-guard.js";
import { writeAudit } from "../plugins/audit.js";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/, "слаг: строчные буквы, цифры, дефисы"),
});

export const registerWorkspacesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const rows = await app.db
      .select({ workspace: workspaces, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, auth.userId), isNull(workspaces.deletedAt)));
    return { workspaces: rows.map((r) => ({ ...r.workspace, role: r.role })) };
  });

  app.post("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может создавать рабочие пространства" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте название и слаг", detail: parsed.error.flatten().fieldErrors });
    const exists = await app.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, parsed.data.slug)).limit(1);
    if (exists[0]) return reply.code(409).send({ error: "Рабочее пространство с таким слагом уже существует" });
    const inserted = await app.db.insert(workspaces).values({ name: parsed.data.name, slug: parsed.data.slug, ownerId: auth.userId }).returning();
    const ws = inserted[0];
    if (!ws) return reply.code(500).send({ error: "Не удалось создать рабочее пространство" });
    await app.db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: auth.userId, role: "owner" });
    await writeAudit(app.db, { userId: auth.userId, workspaceId: ws.id }, { action: "workspace.created", entity: "workspace", entityId: ws.id });
    return reply.code(201).send(ws);
  });

  app.get("/:id", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const ws = await resolveWorkspaceOrThrow(app.db, auth.userId, (request.params as { id: string }).id);
    const members = await app.db.select({ userId: workspaceMembers.userId, role: workspaceMembers.role }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws.workspace.id));
    return { workspace: ws.workspace, role: ws.role, members };
  });
};
