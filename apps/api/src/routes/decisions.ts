import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { decisions } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerDecisionsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: decisions,
    idColumn: decisions.id,
    workspaceColumn: decisions.workspaceId,
    softDeleteColumn: undefined,
    orderBy: decisions.createdAt,
    entityName: "Решение",
    createSchema: z.object({ question: z.string().min(1).max(1000), objective: z.string().max(3000).optional(), status: z.enum(['open','analyzing','decided','expired','cancelled']).default('open'), constraints: z.string().max(5000).optional(), assumptions: z.string().max(5000).optional() }),
    updateSchema: z.object({ question: z.string().min(1).max(1000), objective: z.string().max(3000).optional(), status: z.enum(['open','analyzing','decided','expired','cancelled']).default('open'), constraints: z.string().max(5000).optional(), assumptions: z.string().max(5000).optional() }).partial(),
  }));
};
