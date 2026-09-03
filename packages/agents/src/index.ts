import type { ChatRequest } from "@imperium/ai";

export interface AgentDefinition {
  id: string;
  name: string;
  kind: string;
  systemInstructions: string;
  tools: string[];
  maxSteps: number;
  modelProfile: "fast" | "reasoning" | "coding" | "vision";
  approvalPolicy: "never" | "on_external_write" | "always";
}

export interface AgentRunContext {
  runId: string;
  agentId: string;
  workspaceId: string;
  userId: string;
  missionId?: string;
  stepBudget: number;
  toolBudget: number;
  deadline: Date | null;
  scopes: string[];
}

export interface AgentStepResult {
  step: number;
  content: string | null;
  toolCalls: number;
  finishReason: "stop" | "tool_calls" | "length" | "error";
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; estimatedCostUsd: number | null } | null;
}

export interface AgentRuntime {
  run(req: ChatRequest, ctx: AgentRunContext, profile?: "fast" | "reasoning"): Promise<AgentStepResult>;
}

export { DefaultAgentRuntime, type RuntimeOptions } from "./runtime.js";
