import { Redis } from "ioredis";
import { ModelRouter } from "@imperium/ai";
import { DefaultAgentRuntime } from "@imperium/agents";
import type { ProviderCredentials } from "@imperium/ai";

const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");

const credentials: ProviderCredentials[] = [
  {
    id: "test",
    kind: "test",
    label: "Deterministic test provider",
  },
];

const router = new ModelRouter({ credentials });
const runtime = new DefaultAgentRuntime(router, {
  maxSteps: 10,
  stepTimeoutMs: 30_000,
});

export async function startWorker() {
  console.log("[worker] очередь миссий запущена");
  return { redis, runtime };
}

if (process.argv[1]?.endsWith("index.ts")) {
  await startWorker();
}
