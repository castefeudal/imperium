import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { people } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerPeopleRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: people,
    idColumn: people.id,
    workspaceColumn: people.workspaceId,
    softDeleteColumn: undefined,
    orderBy: people.createdAt,
    entityName: "Контакт",
    createSchema: z.object({ name: z.string().min(1).max(200), organization: z.string().max(200).optional(), role: z.string().max(200).optional(), contacts: z.record(z.unknown()).optional(), notes: z.string().max(10000).optional(), lastInteractionAt: z.coerce.date().optional(), followUpAt: z.coerce.date().optional() }),
    updateSchema: z.object({ name: z.string().min(1).max(200), organization: z.string().max(200).optional(), role: z.string().max(200).optional(), contacts: z.record(z.unknown()).optional(), notes: z.string().max(10000).optional(), lastInteractionAt: z.coerce.date().optional(), followUpAt: z.coerce.date().optional() }).partial(),
  }));
};
