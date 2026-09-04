#!/usr/bin/env node
/**
 * Hermes → IMPERIUM smoke.
 * Проверяет полный контракт провайдера: models, chat, stream, JSON mode,
 * tool_call, tool-result continuation, ошибки авторизации.
 *
 * Использование:
 *   IMPERIUM_URL=http://127.0.0.1:3101 IMPERIUM_KEY=imp_... node scripts/hermes-smoke.mjs
 */
import { setTimeout as sleep } from "node:timers/promises";

const BASE = process.env.IMPERIUM_URL ?? "http://127.0.0.1:3101";
const KEY = process.env.IMPERIUM_KEY;
if (!KEY) {
  console.error("Нужен IMPERIUM_KEY (bearer API-ключ IMPERIUM). Ключ не логируется.");
  process.exit(1);
}

let passed = 0;
let failed = 0;
const step = (name, ok, extra = "") => {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const chat = async (body, headers = {}) => {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}`, ...headers },
    body: JSON.stringify(body),
  });
  return res;
};

// 1. /v1/models
const modelsRes = await fetch(`${BASE}/v1/models`, { headers: { Authorization: `Bearer ${KEY}` } });
const modelsJson = await modelsRes.json();
const ids = modelsJson?.data?.map((m) => m.id) ?? [];
step("GET /v1/models", modelsRes.ok && ids.includes("imperium-auto"), `models: ${ids.length}`);

// 2. Обычный completion
const chatRes = await chat({ model: "imperium-auto", messages: [{ role: "user", content: "привет" }] });
const chatJson = await chatRes.json();
step("chat completion", chatRes.ok && typeof chatJson?.choices?.[0]?.message?.content === "string");

// 3. Streaming (SSE)
const streamRes = await chat({ model: "imperium-auto", stream: true, messages: [{ role: "user", content: "стрим" }] });
const streamText = await streamRes.text();
const streamOk = streamRes.ok && streamText.includes("data:") && streamText.includes("[DONE]");
step("streaming completion", streamOk);

// 4. JSON mode
const jsonRes = await chat({
  model: "imperium-auto",
  response_format: { type: "json_object" },
  messages: [{ role: "user", content: "дай json" }],
});
const jsonBody = await jsonRes.json();
let jsonModeOk = jsonRes.ok;
try { JSON.parse(jsonBody.choices[0].message.content); } catch { jsonModeOk = false; }
step("json mode", jsonModeOk);

// 5. tool_call: модель возвращает вызов инструмента
const toolRes = await chat({
  model: "imperium-auto",
  messages: [{ role: "user", content: "какая погода в Москве?" }],
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "Текущая погода",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  }],
});
const toolJson = await toolRes.json();
const msg = toolJson?.choices?.[0]?.message;
const toolCall = msg?.tool_calls?.[0];
step("tool_call returned", toolRes.ok && toolCall?.function?.name === "get_weather" && !!toolCall.id);

// 6. tool-result continuation: role=tool в истории
const contRes = await chat({
  model: "imperium-auto",
  messages: [
    { role: "user", content: "какая погода в Москве?" },
    { role: "assistant", tool_calls: [toolCall] },
    { role: "tool", tool_call_id: toolCall.id, content: '{"temp_c":-3,"condition":"snow"}' },
  ],
  tools: [{
    type: "function",
    function: {
      name: "get_weather",
      description: "Текущая погода",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  }],
});
const contJson = await contRes.json();
step("tool-result continuation", contRes.ok && typeof contJson?.choices?.[0]?.message?.content === "string");

// 7. Неверный ключ → 401
const badRes = await fetch(`${BASE}/v1/models`, { headers: { Authorization: "Bearer imp_invalid_key_000" } });
step("invalid key → 401", badRes.status === 401);

// 8. Без ключа → 401
const noKeyRes = await fetch(`${BASE}/v1/models`);
step("missing key → 401", noKeyRes.status === 401);

console.log(`\nИтог: ${passed} pass, ${failed} fail`);
process.exit(failed > 0 ? 1 : 0);
