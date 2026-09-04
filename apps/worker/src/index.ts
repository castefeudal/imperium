import { Redis } from "ioredis";
import { ModelRouter } from "@imperium/ai";
import { DefaultAgentRuntime } from "@imperium/agents";
import type { ProviderCredentials } from "@imperium/ai";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, inArray } from "drizzle-orm";
import { missions, missionSteps, agentRuns, costLedger } from "@imperium/database";

const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const db = drizzle(postgres(process.env.DATABASE_URL ?? "postgresql://imperium:imperium_dev@127.0.0.1:5432/imperium"));

const credentials: ProviderCredentials[] = [
  { id: "test", kind: "test", label: "Deterministic test provider" },
];

const router = new ModelRouter({ credentials });
const runtime = new DefaultAgentRuntime(router, {
  maxSteps: 10,
  stepTimeoutMs: 30_000,
});

const QUEUE_KEY = "imperium:missions:queue";
const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 2000);

async function processRun(runId: string): Promise<void> {
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  if (!run || run.status !== "queued") return;
  if (!run.missionId) return;

  await db.update(agentRuns).set({ status: "running", startedAt: new Date() }).where(eq(agentRuns.id, runId));
  await db.update(missions).set({ status: "running" }).where(and(eq(missions.id, run.missionId), eq(missions.status, "draft")));

  let steps = await db.select().from(missionSteps)
    .where(and(eq(missionSteps.missionId, run.missionId), inArray(missionSteps.status, ["pending", "ready"])));
  if (steps.length === 0) {
    const [mission] = await db.select().from(missions).where(eq(missions.id, run.missionId)).limit(1);
    if (mission) {
      await db.insert(missionSteps).values({
        missionId: run.missionId,
        title: "Выполнить цель миссии",
        description: mission.objective,
        status: "pending",
      });
      steps = await db.select().from(missionSteps)
        .where(and(eq(missionSteps.missionId, run.missionId), inArray(missionSteps.status, ["pending", "ready"])));
    }
  }
  if (steps.length === 0) {
    await db.update(agentRuns).set({ status: "done", completedAt: new Date() }).where(eq(agentRuns.id, runId));
    await db.update(missions).set({ status: "reviewing" }).where(eq(missions.id, run.missionId));
    return;
  }

  let failed = 0;
  for (const step of steps) {
    await db.update(missionSteps).set({ status: "running", attempt: step.attempt + 1 }).where(eq(missionSteps.id, step.id));
    try {
      const result = await runtime.run(
        {
          messages: [
            { role: "system", content: "Ты агент IMPERIUM. Выполни шаг миссии и верни краткий результат." },
            { role: "user", content: `Миссия: ${run.missionId}\nШаг: ${step.title}\n${step.description ?? ""}` },
          ],
        },
        { runId, agentId: step.agent ?? "generalist", workspaceId: "", userId: "", stepBudget: run.maxSteps, toolBudget: 20, deadline: null, scopes: [] },
        "fast",
      );
      await db.update(missionSteps).set({ status: "done", output: { content: result.content, finishReason: result.finishReason } }).where(eq(missionSteps.id, step.id));
      if (result.usage) {
        await db.insert(costLedger).values({
          workspaceId: (await db.select({ ws: missions.workspaceId }).from(missions).where(eq(missions.id, run.missionId)).limit(1))[0]!.ws,
          missionId: run.missionId,
          runId,
          provider: "test",
          model: "test-provider",
          tokensIn: result.usage.inputTokens ?? 0,
          tokensOut: result.usage.outputTokens ?? 0,
        });
      }
    } catch (e) {
      failed += 1;
      await db.update(missionSteps).set({ status: "failed", output: { error: String(e) } }).where(eq(missionSteps.id, step.id));
    }
  }

  await db.update(agentRuns).set({ status: failed > 0 ? "failed" : "done", completedAt: new Date(), error: failed > 0 ? `${failed} шаг(ов) провалено` : null }).where(eq(agentRuns.id, runId));
  await db.update(missions).set({ status: failed > 0 ? "failed" : "reviewing" }).where(eq(missions.id, run.missionId));
}

export async function startWorker() {
  console.log("[worker] очередь миссий запущена");
  let stopped = false;
  while (!stopped) {
    try {
      const runId = await redis.lpop(QUEUE_KEY);
      if (runId) {
        console.log(`[worker] run ${runId}`);
        await processRun(runId);
      } else {
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
    } catch (e) {
      console.error("[worker] ошибка цикла:", e instanceof Error ? e.message : e);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
  return { redis, runtime };
}

if (process.argv[1]?.endsWith("index.ts")) {
  await startWorker();
}
