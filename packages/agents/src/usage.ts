import type { ChatUsage, NormalizedChatUsage } from "@imperium/ai";

/** AgentStepResult allows null token/cost values — providers may omit them. */
export type AgentStepUsage = ChatUsage;

export function normalizeUsage(u: ChatUsage): NormalizedChatUsage {
  return {
    inputTokens: u.inputTokens ?? 0,
    outputTokens: u.outputTokens ?? 0,
    estimatedCostUsd: u.estimatedCostUsd ?? 0,
  };
}
