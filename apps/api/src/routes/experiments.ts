import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { experiments } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerExperimentsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: experiments,
    idColumn: experiments.id,
    workspaceColumn: experiments.workspaceId,
    softDeleteColumn: undefined,
    orderBy: experiments.createdAt,
    entityName: "Эксперимент",
    createSchema: z.object({ hypothesis: z.string().min(1).max(2000), domain: z.enum(['productivity','health','content','marketing','product','habits','other']).default('other'), intervention: z.string().max(5000).optional(), primaryMetric: z.string().max(200).optional(), durationDays: z.number().int().min(1).max(365).optional(), startDate: z.coerce.date().optional(), endDate: z.coerce.date().optional(), status: z.enum(['planned','running','completed','stopped']).default('planned'), stopRule: z.string().max(2000).optional() }),
    updateSchema: z.object({ hypothesis: z.string().min(1).max(2000), domain: z.enum(['productivity','health','content','marketing','product','habits','other']).default('other'), intervention: z.string().max(5000).optional(), primaryMetric: z.string().max(200).optional(), durationDays: z.number().int().min(1).max(365).optional(), startDate: z.coerce.date().optional(), endDate: z.coerce.date().optional(), status: z.enum(['planned','running','completed','stopped']).default('planned'), stopRule: z.string().max(2000).optional() }).partial(),
  }));
};
