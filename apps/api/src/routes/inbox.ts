import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { inboxItems } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerInboxRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: inboxItems,
    idColumn: inboxItems.id,
    workspaceColumn: inboxItems.workspaceId,
    softDeleteColumn: undefined,
    orderBy: inboxItems.createdAt,
    entityName: "Входящее",
    createSchema: z.object({ channel: z.enum(['system','email','telegram','github','agent','automation','integration']).default('system'), title: z.string().min(1).max(500), body: z.string().max(100000).optional(), source: z.string().max(200).optional(), category: z.enum(['decision','action','waiting','fyi','ignore']).default('fyi'), importance: z.number().min(0).max(1).default(0.5) }),
    updateSchema: z.object({ channel: z.enum(['system','email','telegram','github','agent','automation','integration']).default('system'), title: z.string().min(1).max(500), body: z.string().max(100000).optional(), source: z.string().max(200).optional(), category: z.enum(['decision','action','waiting','fyi','ignore']).default('fyi'), importance: z.number().min(0).max(1).default(0.5) }).partial(),
  }));
};
