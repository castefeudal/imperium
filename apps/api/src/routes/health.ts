import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  healthEntries, bodyMeasurements, workouts, nutritionEntries,
  sleepEntries, recoveryEntries, labResults, symptoms, interventions,
} from "@imperium/database";
import { and, desc, eq, gte } from "drizzle-orm";
import { csrfOk, requireAuth } from "../plugins/auth-helpers.js";

const SENSITIVE_NOTE = "Данные здоровья конфиденциальны и не попадают в AI-контекст без явного запроса.";

function dateRange(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

export const registerHealthRoutes: FastifyPluginAsync = async (app) => {
  // Универсальный обработчик подразделов здоровья: список + создание.
  type Row = Record<string, unknown>;
  const sub = <T extends Row>(table: Parameters<typeof app.db.select>[0] extends never ? never : any, days: number) => ({
    list: async (request: any, reply: any) => {
      const auth = await requireAuth(app, request, reply);
      if (!auth) return;
      return app.db.select().from(table)
        .where(and(eq(table.workspaceId, auth.workspaceId), gte(table.recordedAt ?? table.createdAt ?? table.id, dateRange(days))))
        .orderBy(desc(table.recordedAt ?? table.createdAt ?? table.id)).limit(200);
    },
    create: async (request: any, reply: any) => {
      const auth = await requireAuth(app, request, reply);
      if (!auth) return;
      if (!csrfOk(request, auth)) return reply.code(403).send({ error: "Недействительный CSRF-токен" });
      const [row] = await app.db.insert(table).values({ ...(request.body as Row), workspaceId: auth.workspaceId }).returning();
      return reply.code(201).send(row);
    },
  });

  const sections: Record<string, { table: any; days: number }> = {
    body: { table: bodyMeasurements, days: 365 },
    training: { table: workouts, days: 90 },
    nutrition: { table: nutritionEntries, days: 30 },
    sleep: { table: sleepEntries, days: 30 },
    recovery: { table: recoveryEntries, days: 30 },
    labs: { table: labResults, days: 730 },
    symptoms: { table: symptoms, days: 180 },
    interventions: { table: interventions, days: 365 },
  };

  for (const [name, cfg] of Object.entries(sections)) {
    const h = sub(cfg.table, cfg.days);
    app.get(`/${name}`, h.list);
    app.post(`/${name}`, h.create);
  }

  // Сводка для Today: последние значения ключевых метрик.
  app.get("/overview", async (request, reply) => {
    const auth = await requireAuth(app, request, reply);
    if (!auth) return;
    const since = dateRange(30);
    const [sleep, weight, training] = await Promise.all([
      app.db.select().from(sleepEntries).where(and(eq(sleepEntries.workspaceId, auth.workspaceId), gte(sleepEntries.recordedAt, since))).orderBy(desc(sleepEntries.recordedAt)).limit(7),
      app.db.select().from(bodyMeasurements).where(and(eq(bodyMeasurements.workspaceId, auth.workspaceId), gte(bodyMeasurements.recordedAt, since))).orderBy(desc(bodyMeasurements.recordedAt)).limit(5),
      app.db.select().from(workouts).where(and(eq(workouts.workspaceId, auth.workspaceId), gte(workouts.createdAt, since))).orderBy(desc(workouts.createdAt)).limit(7),
    ]);
    return {
      disclaimer: "IMPERIUM не ставит диагнозы. При сомнениях обратитесь к врачу.",
      note: SENSITIVE_NOTE,
      sleepHours: sleep.map((s) => ({ date: s.recordedAt, hours: s.durationSec != null ? s.durationSec / 3600 : null })),
      weightKg: weight.map((w) => ({ date: w.recordedAt, kg: w.weightKg })),
      workouts: training.length,
    };
  });
};
