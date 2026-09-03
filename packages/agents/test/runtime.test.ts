import { DefaultAgentRuntime } from "../src/runtime.js";
import { testProvider } from "@imperium/ai";
import type { AgentRuntime } from "../src/index.js";
import { describe, it, expect } from "vitest";
import { DefaultAgentRuntime } from "../src/runtime.js";

const ctx = {
  runId: "run_test",
  agentId: "agent_test",
  workspaceId: "ws_test",
  userId: "user_test",
  stepBudget: 10,
  toolBudget: 10,
  deadline: null,
  scopes: ["read:tasks"],
};

describe("AgentRuntime", () => {
  it("completes a single-step run with the test provider", async () => {
    const runtime: AgentRuntime = new DefaultAgentRuntime(
      { chat: async (req, _profile) => await testProvider().chat({}, req) },
      { provider: "test", maxSteps: 1, stepTimeoutMs: 5_000 },
    );
    const res = await runtime.run(
      { messages: [{ role: "user", content: "Привет" }] },
      ctx,
      "fast",
    );
    expect(res.finishReason).toBe("stop");
    expect(res.content).toContain("Эхо");
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
