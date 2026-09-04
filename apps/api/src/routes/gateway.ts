import type { FastifyPluginAsync } from "fastify";
import type { ChatMessage, ToolSpec } from "@imperium/ai";
import { extractBearerToken, scopeAllows } from "../plugins/auth-helpers.js";

// ── Виртуальные модели IMPERIUM (OpenAI-compatible gateway) ────────
const VIRTUAL_MODELS = [
  { id: "imperium-auto", profile: "fast", description: "Авто-выбор профиля модели" },
  { id: "imperium-fast", profile: "fast", description: "Быстрая модель (AI_FAST_MODEL)" },
  { id: "imperium-reasoning", profile: "reasoning", description: "Рассуждающая модель (AI_REASONING_MODEL)" },
  { id: "imperium-coding", profile: "coding", description: "Модель для кода (AI_CODING_MODEL)" },
] as const;

type Profile = "fast" | "reasoning" | "coding" | "vision" | "embedding";

const MODEL_IDS = new Set<string>(VIRTUAL_MODELS.map((m) => m.id));

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function openAiError(status: number, message: string, code: string, type = "invalid_request_error") {
  return { statusCode: status, error: { message, type, param: null, code } };
}

/** Преобразует OpenAI messages → внутренний ChatMessage[]. */
function toInternalMessages(messages: unknown): ChatMessage[] {
  if (!Array.isArray(messages)) return [];
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const role = (m as { role?: string }).role;
    const content = (m as { content?: unknown }).content;
    const text = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((c) => (typeof c === "object" && c && "text" in c ? String((c as { text: string }).text) : "")).join("")
      : "";
    if (role === "system" || role === "user" || role === "assistant") {
      out.push({ role, content: text });
    }
  }
  return out;
}

/** Преобразует OpenAI tools → внутренний ToolSpec[]. */
function toInternalTools(tools: unknown): ToolSpec[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const out: ToolSpec[] = [];
  for (const t of tools) {
    const fn = (t as { function?: { name?: string; description?: string; parameters?: unknown } }).function;
    if (fn?.name) {
      out.push({
        name: fn.name,
        description: fn.description ?? "",
        inputSchema: (fn.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

export const registerGatewayRoutes: FastifyPluginAsync = async (app) => {
  // ── Auth для всех /v1 маршрутов: только bearer API-ключ ──────────
  app.addHook("onRequest", async (request, reply) => {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send(openAiError(401, "Отсутствует или неверный API-ключ (Authorization: Bearer imp_...)", "invalid_api_key", "authentication_error"));
    }
    const auth = await import("../plugins/auth-helpers.js").then((m) => m.getAuth(request, app.db));
    if (!auth || auth.authType !== "api_key") {
      return reply.code(401).send(openAiError(401, "Недействительный, отозванный или истёкший API-ключ", "invalid_api_key", "authentication_error"));
    }
    if (!scopeAllows(auth, "read")) {
      return reply.code(403).send(openAiError(403, "У ключа нет права на использование моделей (нужен scope: read)", "insufficient_scope", "authentication_error"));
    }
    request.auth = auth;
  });

  const requestId = (request: { id?: string }) => String(request.id ?? `req_${nowEpoch()}`);

  // ── GET /v1/models ────────────────────────────────────────────────
  app.get("/models", async (request) => {
    void requestId(request);
    return {
      object: "list",
      data: VIRTUAL_MODELS.map((m) => ({
        id: m.id,
        object: "model",
        created: 0,
        owned_by: "imperium",
      })),
    };
  });

  app.get("/models/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!MODEL_IDS.has(id)) {
      return reply.code(404).send(openAiError(404, `Модель '${id}' не найдена`, "model_not_found"));
    }
    return { id, object: "model", created: 0, owned_by: "imperium" };
  });

  // ── POST /v1/chat/completions ────────────────────────────────────
  app.post("/chat/completions", async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const model = typeof body.model === "string" ? body.model : "imperium-auto";
    if (!MODEL_IDS.has(model)) {
      return reply.code(404).send(openAiError(404, `Модель '${model}' не найдена`, "model_not_found"));
    }
    const messages = toInternalMessages(body.messages);
    if (messages.length === 0) {
      return reply.code(400).send(openAiError(400, "messages: ожидается непустой массив сообщений", "invalid_messages"));
    }
    const profile = (VIRTUAL_MODELS.find((m) => m.id === model)?.profile ?? "fast") as Profile;
    const stream = body.stream === true;

    const chatRequest = {
      messages,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : typeof body.max_completion_tokens === "number" ? body.max_completion_tokens : undefined,
      tools: toInternalTools(body.tools),
      toolChoice: (body.tool_choice === "none" || body.tool_choice === "auto" || body.tool_choice === "required") ? body.tool_choice as "auto" | "none" | "required" : undefined,
      responseFormatJson: (body.response_format as { type?: string } | undefined)?.type === "json_object",
    };

    try {
      const res = await app.modelRouter.chat(chatRequest, profile);
      const rid = requestId(request);
      const completionId = `chatcmpl-${crypto.randomUUID()}`;
      const created = nowEpoch();

      if (stream) {
        reply.header("content-type", "text/event-stream; charset=utf-8");
        reply.header("cache-control", "no-cache");
        reply.header("connection", "keep-alive");
        reply.header("x-request-id", rid);
        // Compatibility-stream: полный результат → protocol-correct chunks.
        let payload: string | null = res.content;
        let finish: "stop" | "tool_calls" | "length" = res.finishReason === "tool_calls" ? "tool_calls" : res.finishReason === "length" ? "length" : "stop";
        if (res.toolCalls.length > 0) {
          payload = payload ?? "";
          finish = "tool_calls";
        }
        const chunkBase = { id: completionId, object: "chat.completion.chunk", created, model, system_fingerprint: `imperium_${res.provider}` };
        if (payload) {
          reply.raw.write(`data: ${JSON.stringify({ ...chunkBase, choices: [{ index: 0, delta: { role: "assistant", content: payload }, finish_reason: null }] })}\n\n`);
        }
        if (finish === "tool_calls") {
          for (const [i, tc] of res.toolCalls.entries()) {
            reply.raw.write(`data: ${JSON.stringify({ ...chunkBase, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: "function", function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) } }] }, finish_reason: null }] })}\n\n`);
          }
        }
        reply.raw.write(`data: ${JSON.stringify({ ...chunkBase, choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`);
        reply.raw.write(`data: ${JSON.stringify({ ...chunkBase, choices: [], usage: { prompt_tokens: res.usage.inputTokens ?? 0, completion_tokens: res.usage.outputTokens ?? 0, total_tokens: (res.usage.inputTokens ?? 0) + (res.usage.outputTokens ?? 0) } })}\n\n`);
        reply.raw.write("data: [DONE]\n\n");
        reply.raw.end();
        return reply;
      }

      const message: Record<string, unknown> = { role: "assistant", content: res.content ?? "" };
      if (res.toolCalls.length > 0) {
        message.tool_calls = res.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
        }));
        message.content = res.content ?? null;
      }
      return {
        id: completionId,
        object: "chat.completion",
        created,
        model,
        system_fingerprint: `imperium_${res.provider}`,
        choices: [{ index: 0, message, finish_reason: res.finishReason === "tool_calls" ? "tool_calls" : res.finishReason === "length" ? "length" : "stop", logprobs: null }],
        usage: {
          prompt_tokens: res.usage.inputTokens ?? 0,
          completion_tokens: res.usage.outputTokens ?? 0,
          total_tokens: (res.usage.inputTokens ?? 0) + (res.usage.outputTokens ?? 0),
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      request.log.warn({ err: msg }, "gateway: провайдер недоступен");
      return reply.code(502).send(openAiError(502, "Модель недоступна: не настроен ни один AI-провайдер с валидным ключом. Задайте OPENAI_API_KEY / OPENROUTER_API_KEY / ANTHROPIC_API_KEY в настройках окружения.", "provider_unavailable", "api_error"));
    }
  });
};
