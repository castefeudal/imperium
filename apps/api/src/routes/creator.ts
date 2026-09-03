import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { contentItems as creator } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerCreatorRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: creator,
    idColumn: creator.id,
    workspaceColumn: creator.workspaceId,
    softDeleteColumn: undefined,
    orderBy: creator.createdAt,
    entityName: "Контент",
    createSchema: z.object({ title: z.string().min(1).max(400), platform: z.enum(['short_video','long_video','telegram','article','linkedin','x','newsletter','other']).default('other'), format: z.string().max(100).optional(), pillar: z.string().max(100).optional(), status: z.enum(['idea','brief','script','production','review','scheduled','published','archived']).default('idea'), hook: z.string().max(2000).optional(), script: z.string().max(100000).optional(), cta: z.string().max(1000).optional(), scheduledAt: z.coerce.date().optional(), publishedAt: z.coerce.date().optional(), externalUrl: z.string().url().max(2000).optional() }),
    updateSchema: z.object({ title: z.string().min(1).max(400), platform: z.enum(['short_video','long_video','telegram','article','linkedin','x','newsletter','other']).default('other'), format: z.string().max(100).optional(), pillar: z.string().max(100).optional(), status: z.enum(['idea','brief','script','production','review','scheduled','published','archived']).default('idea'), hook: z.string().max(2000).optional(), script: z.string().max(100000).optional(), cta: z.string().max(1000).optional(), scheduledAt: z.coerce.date().optional(), publishedAt: z.coerce.date().optional(), externalUrl: z.string().url().max(2000).optional() }).partial(),
  }));
};
