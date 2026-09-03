import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { documents } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerKnowledgeRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: documents,
    idColumn: documents.id,
    workspaceColumn: documents.workspaceId,
    softDeleteColumn: undefined,
    orderBy: documents.createdAt,
    entityName: "Документ",
    createSchema: z.object({ title: z.string().min(1).max(400), sourceType: z.enum(['upload','url','integration','generated','agent']).default('upload'), sourceUrl: z.string().url().max(2000).optional(), content: z.string().max(2_000_000).optional(), tags: z.array(z.string().max(50)).max(20).optional() }),
    updateSchema: z.object({ title: z.string().min(1).max(400), sourceType: z.enum(['upload','url','integration','generated','agent']).default('upload'), sourceUrl: z.string().url().max(2000).optional(), content: z.string().max(2_000_000).optional(), tags: z.array(z.string().max(50)).max(20).optional() }).partial(),
  }));
};
