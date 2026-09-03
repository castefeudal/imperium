import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { workspaces, workspaceMembers } from "@imperium/database";
import { and, eq, isNull } from "drizzle-orm";
import { requireAuth } from "../plugins/auth-helpers.js";
import { resolveWorkspaceOrThrow } from "../plugins/workspace-guard.js";


const createSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Слаг: строчные латинские буквы и дефисы"),
});

export const registerWorkspacesRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const rows = await app.db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug, role: workspaceMembers.role, createdAt: workspaces.createdAt })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, auth.userId), isNull(workspaces.deletedAt)));
    return { workspaces: rows, active: auth.workspaceId };
  });

  app.post("/", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    if (auth.role === "viewer") return reply.code(403).send({ error: "Наблюдатель не может создавать рабочие пространства" });
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Проверьте название и слаг", detail: parsed.error.flatten().fieldErrors });
    const exists = await app.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, parsed.data.slug)).limit(1);
    if (exists[0]) return reply.code(409).send({ error: "Рабочее пространство с таким слагом уже существует" });
    const [ws] = await app.db.insert(workspaces).values({ name: parsed.data.name, slug: parsed.data.slug, ownerId: auth.userId }).returning();
    await app.db.insert(workspaceMembers).values({ workspaceId: ws.id, userId: auth.userId, role: auth.role === "member" ? "admin" : auth.role });
    const { audit } = await import("../plugins/auth-core.js");
    await audit(app.db, { userId: auth.userId, workspaceId: ws.id, action: "workspace.created", entity: "workspace", entityId: ws.id });
    return reply.code(201).send(ws);
  });

  app.get("/:id", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const ws = await resolveWorkspaceOrThrow(app.db, auth.userId, (request.params as { id: string }).id);
    const members = await app.db.select({ userId: workspaceMembers.userId, role: workspaceMembers.role }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, ws.id));
    return { workspace: ws, members };
  });
};
