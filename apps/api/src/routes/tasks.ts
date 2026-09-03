import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { tasks } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerTasksRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: tasks,
    idColumn: tasks.id,
    workspaceColumn: tasks.workspaceId,
    softDeleteColumn: undefined,
    orderBy: tasks.createdAt,
    entityName: "Задача",
    createSchema: z.object({ title: z.string().min(1).max(300), description: z.string().max(10000).optional(), projectId: z.string().uuid().optional(), goalId: z.string().uuid().optional(), status: z.enum(['inbox','today','upcoming','backlog','in_progress','completed','cancelled']).default('inbox'), priority: z.enum(['low','medium','high','critical']).default('medium'), dueAt: z.coerce.date().optional(), startAt: z.coerce.date().optional(), estimateMinutes: z.number().int().min(0).max(100000).optional(), tags: z.array(z.string().max(50)).max(20).optional(), recurrence: z.string().max(100).optional() }),
    updateSchema: z.object({ title: z.string().min(1).max(300), description: z.string().max(10000).optional(), projectId: z.string().uuid().optional(), goalId: z.string().uuid().optional(), status: z.enum(['inbox','today','upcoming','backlog','in_progress','completed','cancelled']).default('inbox'), priority: z.enum(['low','medium','high','critical']).default('medium'), dueAt: z.coerce.date().optional(), startAt: z.coerce.date().optional(), estimateMinutes: z.number().int().min(0).max(100000).optional(), tags: z.array(z.string().max(50)).max(20).optional(), recurrence: z.string().max(100).optional() }).partial(),
  }));
};
