import type { FastifyPluginAsync } from "fastify";
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import {
  goals,
  inboxItems,
  missions,
  tasks,
} from "@imperium/database";
import { requireAuth } from "../plugins/auth-helpers.js";

/**
 * GET /api/v1/today — сводка "Что важно сейчас":
 * просроченные и сегодняшние задачи, приоритетные, активные цели,
 * активные миссии, счётчик inbox.
 */
export const registerTodayRoutes: FastifyPluginAsync = async (app) => {
  app.get("/", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const ws = auth.workspaceId;
    const now = new Date();
    const endOfToday = new Date(now);
    endOfToday.setHours(23, 59, 59, 999);

    const [overdue, dueToday, topPriority, activeGoals, activeMissions, inboxCount] = await Promise.all([
      app.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ws), inArray(tasks.status, ["todo", "in_progress"]), isNotNull(tasks.dueAt), lte(tasks.dueAt, now)))
        .orderBy(tasks.dueAt)
        .limit(20),
      app.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ws), inArray(tasks.status, ["todo", "in_progress"]), gte(tasks.dueAt, now), lte(tasks.dueAt, endOfToday)))
        .orderBy(tasks.dueAt)
        .limit(20),
      app.db
        .select()
        .from(tasks)
        .where(and(eq(tasks.workspaceId, ws), inArray(tasks.status, ["todo", "in_progress"]), lte(tasks.priority, 2)))
        .orderBy(tasks.priority, desc(tasks.createdAt))
        .limit(10),
      app.db
        .select()
        .from(goals)
        .where(and(eq(goals.workspaceId, ws), eq(goals.status, "active")))
        .orderBy(desc(goals.updatedAt))
        .limit(10),
      app.db
        .select()
        .from(missions)
        .where(and(eq(missions.workspaceId, ws), ne(missions.status, "draft"), ne(missions.status, "completed"), ne(missions.status, "cancelled")))
        .orderBy(desc(missions.createdAt))
        .limit(10),
      app.db
        .select({ count: sql<number>`count(*)::int` })
        .from(inboxItems)
        .where(and(eq(inboxItems.workspaceId, ws), isNull(inboxItems.readAt))),
    ]);

    return {
      date: now.toISOString(),
      overdue: overdue.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, priority: t.priority, status: t.status })),
      dueToday: dueToday.map((t) => ({ id: t.id, title: t.title, dueAt: t.dueAt, priority: t.priority, status: t.status })),
      topPriority: topPriority.map((t) => ({ id: t.id, title: t.title, priority: t.priority, status: t.status })),
      activeGoals: activeGoals.map((g) => ({ id: g.id, title: g.title, progress: g.progress, targetDate: g.targetDate })),
      activeMissions: activeMissions.map((m) => ({ id: m.id, title: m.title, status: m.status })),
      inboxCount: inboxCount[0]?.count ?? 0,
    };
  });
};
