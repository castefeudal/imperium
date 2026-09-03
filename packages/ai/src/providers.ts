import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ProviderCredentials,
  ProviderKind,
  ToolCall,
} from "./types.js";
import { ProviderError } from "./types.js";
import { extractJson } from "./json.js";

export interface ProviderAdapter {
  readonly kind: ProviderKind;
  chat(creds: ProviderCredentials, req: ChatRequest): Promise<ChatResponse>;
}

const DEFAULT_TIMEOUT_MS = 120_000;

async function fetchJson(url: string, init: globalThis.RequestInit): Promise<unknown> {
  const signal = init.signal as AbortSignal | undefined;
  const timeout = AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal2 = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: signal2 });
  } catch (e) {
    throw new ProviderError(`Сетевая ошибка провайдера: ${String((e as Error).message).slice(0, 200)}`, {
      kind: "openai-compatible",
      retryable: true,
      cause: e,
    });
  }
  const body = await res.text();
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    let detail = body.slice(0, 300);
    try {
      const j = JSON.parse(body) as { error?: { message?: string } | string };
      const msg = typeof j.error === "string" ? j.error : j.error?.message;
      if (msg) detail = msg;
    } catch {
      // keep raw slice
    }
    throw new ProviderError(`Провайдер вернул ${res.status}: ${detail}`, {
      kind: "openai-compatible",
      status: res.status,
      retryable,
    });
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ProviderError("Некорректный JSON от провайдера", { kind: "openai-compatible", retryable: true });
  }
}

// ── OpenAI-compatible (OpenAI, OpenRouter, Ollama, gateways) ──────

interface OpenAICompletion {
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  model?: string;
  error?: { message?: string } | string;
}

export function openAiCompatibleAdapter(): ProviderAdapter {
  return {
    kind: "openai-compatible",
    async chat(creds, req) {
      const started = Date.now();
      const baseUrl = (creds.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
      const body: Record<string, unknown> = {
        model: req.model ?? "gpt-4o-mini",
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: req.temperature,
        max_tokens: req.maxTokens,
      };
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.inputSchema },
        }));
        if (req.toolChoice === "required") body.tool_choice = "required";
        else if (req.toolChoice === "none") body.tool_choice = "none";
      }
      if (req.responseFormatJson) body.response_format = { type: "json_object" };

      const json = (await fetchJson(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${creds.apiKey ?? ""}`,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      })) as OpenAICompletion;

      const choice = json.choices?.[0];
      const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc, i) => {
        const argsRaw = tc.function?.arguments ?? "{}";
        let args: unknown;
        try {
          args = JSON.parse(argsRaw) as unknown;
        } catch {
          args = extractJson(argsRaw) ?? {};
        }
        return { id: tc.id ?? `call_${i}`, name: tc.function?.name ?? "", args };
      });
      const finishRaw = choice?.finish_reason ?? "stop";
      const finishReason =
        toolCalls.length > 0 ? ("tool_calls" as const) : finishRaw === "length" ? ("length" as const) : ("stop" as const);

      return {
        content: choice?.message?.content ?? null,
        toolCalls,
        finishReason,
        usage: {
          inputTokens: json.usage?.prompt_tokens ?? null,
          outputTokens: json.usage?.completion_tokens ?? null,
          estimatedCostUsd: null,
        },
        provider: creds.kind,
        model: req.model ?? "unknown",
        latencyMs: Date.now() - started,
        raw: json,
      };
    },
  };
}

// ── Anthropic ─────────────────────────────────────────────────────

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason?: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export function anthropicAdapter(): ProviderAdapter {
  return {
    kind: "anthropic",
    async chat(creds, req) {
      const started = Date.now();
      const baseUrl = (creds.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
      const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const msgs = req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      const body: Record<string, unknown> = {
        model: req.model ?? "claude-sonnet-4-20250514",
        max_tokens: req.maxTokens ?? 4096,
        messages: msgs,
      };
      if (system) body.system = system;
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.tools?.length) {
        body.tools = req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }));
      }
      const json = (await fetchJson(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": creds.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: req.signal,
      })) as AnthropicResponse;

      const blocks = json.content ?? [];
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n") || null;
      const toolCalls: ToolCall[] = blocks
        .filter((b) => b.type === "tool_use")
        .map((b, i) => ({ id: b.id ?? `call_${i}`, name: b.name ?? "", args: b.input }));
      const finishReason =
        toolCalls.length > 0 ? ("tool_calls" as const) : json.stop_reason === "max_tokens" ? ("length" as const) : ("stop" as const);

      return {
        content: text,
        toolCalls,
        finishReason,
        usage: {
          inputTokens: json.usage?.input_tokens ?? null,
          outputTokens: json.usage?.output_tokens ?? null,
          estimatedCostUsd: null,
        },
        provider: "anthropic",
        model: req.model ?? "unknown",
        latencyMs: Date.now() - started,
        raw: json,
      };
    },
  };
}

// ── Google Gemini ─────────────────────────────────────────────────

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: unknown } }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export function googleAdapter(): ProviderAdapter {
  return {
    kind: "google",
    async chat(creds, req) {
      const started = Date.now();
      const model = req.model ?? "gemini-2.0-flash";
      const baseUrl = (creds.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta").replace(/\/$/, "");
      const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const contents = req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));
      const body: Record<string, unknown> = {
        contents,
        generationConfig: {
          temperature: req.temperature,
          maxOutputTokens: req.maxTokens,
        },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      if (req.tools?.length) {
        body.tools = [
          {
            functionDeclarations: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            })),
          },
        ];
      }
      const json = (await fetchJson(`${baseUrl}/models/${model}:generateContent?key=${encodeURIComponent(creds.apiKey ?? "")}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: req.signal,
      })) as GeminiResponse;

      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const text = parts.map((p) => p.text ?? "").filter(Boolean).join("\n") || null;
      const toolCalls: ToolCall[] = parts
        .filter((p) => p.functionCall)
        .map((p, i) => ({ id: `call_${i}`, name: p.functionCall?.name ?? "", args: p.functionCall?.args ?? {} }));
      const finishReason =
        toolCalls.length > 0 ? ("tool_calls" as const) : json.candidates?.[0]?.finishReason === "MAX_TOKENS" ? ("length" as const) : ("stop" as const);

      return {
        content: text,
        toolCalls,
        finishReason,
        usage: {
          inputTokens: json.usageMetadata?.promptTokenCount ?? null,
          outputTokens: json.usageMetadata?.candidatesTokenCount ?? null,
          estimatedCostUsd: null,
        },
        provider: "google",
        model,
        latencyMs: Date.now() - started,
        raw: json,
      };
    },
  };
}

export { testProvider } from "./test-provider.js";
