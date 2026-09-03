import { z } from "zod";

export type ProviderKind =
  | "openai-compatible"
  | "anthropic"
  | "google"
  | "openrouter"
  | "ollama"
  | "test";

export interface ProviderCredentials {
  id: string;
  label: string;
  kind: ProviderKind;
  baseUrl?: string;
  apiKey?: string;
  status?: "ok" | "error" | "unknown";
  lastCheckedAt?: string | null;
}

export type ModelProfile = "fast" | "reasoning" | "coding" | "vision" | "embedding" | "fallback";

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolSpec[];
  toolChoice?: "auto" | "none" | "required";
  responseFormatJson?: boolean;
  signal?: AbortSignal;
}

/** Usage as reported by a provider; null fields mean the provider omitted them. */
export interface ChatUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}

/** Normalized usage with nulls replaced by zeros — safe for arithmetic. */
export interface NormalizedChatUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: "stop" | "tool_calls" | "length" | "error";
  usage: ChatUsage;
  provider: ProviderKind;
  model: string;
  latencyMs: number;
  raw?: unknown;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly opts: { kind: ProviderKind; status?: number; retryable?: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
export type { ProviderAdapter } from "./providers.js";
