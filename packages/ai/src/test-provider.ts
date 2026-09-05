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
      const rawContent = replies[turn] ?? `Эхо: ${lastUser?.content.slice(0, 200) ?? ""}`;
      turn++;
      const lastMessage: ChatMessage | undefined = req.messages.at(-1);
      // Deterministic tool-calling: когда объявлены tools и script не задан,
      // возвращаем первый tool, пока последний ход — не результат инструмента.
      const scripted = turn === 1 ? opts.toolCalls : undefined;
      let toolCalls: ToolCall[] = scripted ?? [];
      if (toolCalls.length === 0 && lastMessage?.role !== "tool" && req.tools?.length && req.toolChoice !== "none") {
        const first = req.tools[0]!;
        toolCalls = [{ id: "call_test_1", name: first.name, args: { input: lastUser?.content ?? "" } }];
      }
      // JSON mode: валидный JSON-объект в content.
      const content = req.responseFormatJson && toolCalls.length === 0 ? JSON.stringify({ reply: rawContent }) : rawContent;
      const replyContent = toolCalls.length > 0 ? null : content;
      const finishReason = toolCalls.length > 0 ? ("tool_calls" as const) : ("stop" as const);
      return {
        content: replyContent,
        toolCalls,
        finishReason,
        usage: {
          inputTokens: opts.inputTokens ?? Math.ceil(req.messages.reduce((s, m) => s + m.content.length, 0) / 3.5),
          outputTokens: opts.outputTokens ?? Math.ceil((rawContent.length || 8) / 3.5),
          estimatedCostUsd: 0,
        },
        provider: "test",
        model: "test-model",
        latencyMs: opts.latencyMs ?? 1,
      };
    },
  };
}
