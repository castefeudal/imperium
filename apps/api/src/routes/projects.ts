import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { projects } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerProjectsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: projects,
    idColumn: projects.id,
    workspaceColumn: projects.workspaceId,
    softDeleteColumn: undefined,
    orderBy: projects.createdAt,
    entityName: "Проект",
    createSchema: z.object({ title: z.string().min(1).max(300), summary: z.string().max(3000).optional(), goalId: z.string().uuid().optional(), status: z.enum(['planning','active','on_hold','completed','cancelled']).default('planning'), priority: z.enum(['low','medium','high']).default('medium'), health: z.enum(['ok','attention','at_risk']).optional(), startDate: z.coerce.date().optional(), targetDate: z.coerce.date().optional(), progress: z.number().min(0).max(100).default(0), nextAction: z.string().max(500).optional() }),
    updateSchema: z.object({ title: z.string().min(1).max(300), summary: z.string().max(3000).optional(), goalId: z.string().uuid().optional(), status: z.enum(['planning','active','on_hold','completed','cancelled']).default('planning'), priority: z.enum(['low','medium','high']).default('medium'), health: z.enum(['ok','attention','at_risk']).optional(), startDate: z.coerce.date().optional(), targetDate: z.coerce.date().optional(), progress: z.number().min(0).max(100).default(0), nextAction: z.string().max(500).optional() }).partial(),
  }));
};
