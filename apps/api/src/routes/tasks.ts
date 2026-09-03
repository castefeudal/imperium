import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { tasks } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

const statusEnum = z.enum(["inbox", "today", "upcoming", "backlog", "blocked", "in_progress", "review", "done", "cancelled"]);
const priorityInt = z
  .union([z.enum(["low", "medium", "high", "critical"]), z.number().int().min(1).max(5)])
  .transform((v) => (typeof v === "number" ? v : ({ low: 1, medium: 3, high: 4, critical: 5 } as const)[v]));

const baseFields = {
  title: z.string().min(1).max(300),
  description: z.string().max(10000).optional(),
  projectId: z.string().uuid().optional(),
  goalId: z.string().uuid().optional(),
  assignee: z.string().uuid().optional(),
  status: statusEnum.optional(),
  priority: priorityInt.optional(),
  dueAt: z.coerce.date().optional(),
  startAt: z.coerce.date().optional(),
  estimate: z.number().int().min(0).max(100000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  recurrence: z.string().max(100).optional(),
};

export const registerTasksRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: tasks,
    idColumn: tasks.id,
    workspaceColumn: tasks.workspaceId,
    softDeleteColumn: undefined,
    orderBy: tasks.createdAt,
    entityName: "Задача",
    createSchema: z.object(baseFields),
    updateSchema: z.object(baseFields).partial(),
  }));
};
