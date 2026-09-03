import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { memories } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerMemoryRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: memories,
    idColumn: memories.id,
    workspaceColumn: memories.workspaceId,
    softDeleteColumn: undefined,
    orderBy: memories.createdAt,
    entityName: "Память",
    createSchema: z.object({ type: z.enum(['identity','preference','goal','constraint','semantic','episodic','procedural','decision','outcome']), content: z.string().min(1).max(10000), structuredPayload: z.record(z.unknown()).optional(), confidence: z.number().min(0).max(1).default(0.8), importance: z.number().min(0).max(1).default(0.5), expiresAt: z.coerce.date().nullable().optional() }),
    updateSchema: z.object({ type: z.enum(['identity','preference','goal','constraint','semantic','episodic','procedural','decision','outcome']), content: z.string().min(1).max(10000), structuredPayload: z.record(z.unknown()).optional(), confidence: z.number().min(0).max(1).default(0.8), importance: z.number().min(0).max(1).default(0.5), expiresAt: z.coerce.date().nullable().optional() }).partial(),
  }));
};
