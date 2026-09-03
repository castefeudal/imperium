import type { ChatMessage, ChatRequest, ChatResponse, ToolCall } from "./types.js";

/**
 * Deterministic provider for tests and offline development.
 * Scripted replies: the first assistant turn echoes the last user message
 * (truncated); tool calls are returned verbatim from `scriptToolCalls`.
 */
export interface TestProviderOptions {
  replies?: string[];
  toolCalls?: ToolCall[];
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export function testProvider(opts: TestProviderOptions = {}) {
  let turn = 0;
  const replies = opts.replies ?? [];
  return {
    kind: "test" as const,
    async chat(_creds: unknown, req: ChatRequest): Promise<ChatResponse> {
      const lastUser = [...req.messages].reverse().find((m) => m.role === "user");
      const content = replies[turn] ?? `Эхо: ${lastUser?.content.slice(0, 200) ?? ""}`;
      turn++;
      return {
        content,
        toolCalls: turn === 1 ? (opts.toolCalls ?? []) : [],
        finishReason: "stop",
        usage: {
          inputTokens: opts.inputTokens ?? Math.ceil(req.messages.reduce((s, m) => s + m.content.length, 0) / 3.5),
          outputTokens: opts.outputTokens ?? Math.ceil(content.length / 3.5),
          estimatedCostUsd: 0,
        },
        provider: "test",
        model: "test-model",
        latencyMs: opts.latencyMs ?? 1,
      };
    },
  };
}
