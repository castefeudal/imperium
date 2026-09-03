import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { automations } from "@imperium/database";
import { crudRoutes } from "./crud-factory.js";

export const registerAutomationsRoutes: FastifyPluginAsync = async (app) => {
  await app.register(crudRoutes({
    table: automations,
    idColumn: automations.id,
    workspaceColumn: automations.workspaceId,
    softDeleteColumn: undefined,
    orderBy: automations.createdAt,
    entityName: "Автоматизация",
    createSchema: z.object({ name: z.string().min(1).max(300), triggerType: z.enum(['schedule','cron','webhook','task_event','project_event','mission_event','inbox_item','metric_threshold']).default('schedule'), triggerConfig: z.record(z.unknown()).default({}), condition: z.string().max(3000).optional(), actionType: z.enum(['create_task','update_task','create_mission','run_agent','send_notification','add_note','create_review','webhook','integration_action']).default('create_task'), actionConfig: z.record(z.unknown()).default({}), enabled: z.boolean().default(true) }),
    updateSchema: z.object({ name: z.string().min(1).max(300), triggerType: z.enum(['schedule','cron','webhook','task_event','project_event','mission_event','inbox_item','metric_threshold']).default('schedule'), triggerConfig: z.record(z.unknown()).default({}), condition: z.string().max(3000).optional(), actionType: z.enum(['create_task','update_task','create_mission','run_agent','send_notification','add_note','create_review','webhook','integration_action']).default('create_task'), actionConfig: z.record(z.unknown()).default({}), enabled: z.boolean().default(true) }).partial(),
  }));
};
