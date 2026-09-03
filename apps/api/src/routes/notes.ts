import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { notes } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerNotesRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: notes,
    idColumn: notes.id,
    workspaceColumn: notes.workspaceId,
    softDeleteColumn: undefined,
    orderBy: notes.createdAt,
    entityName: "Заметка",
    createSchema: z.object({ title: z.string().min(1).max(400), body: z.string().max(500000).optional(), tags: z.array(z.string().max(50)).max(20).optional() }),
    updateSchema: z.object({ title: z.string().min(1).max(400), body: z.string().max(500000).optional(), tags: z.array(z.string().max(50)).max(20).optional() }).partial(),
  }));
};
