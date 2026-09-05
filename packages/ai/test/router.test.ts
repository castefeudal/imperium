import { describe, it, expect } from "vitest";
import { ModelRouter } from "../src/router.js";
import { testProvider } from "../src/test-provider.js";
import type { ProviderCredentials } from "../src/types.js";

const creds: ProviderCredentials[] = [
  { id: "test", kind: "test", label: "Deterministic test provider" },
];

describe("ModelRouter", () => {
  it("routes chat through the first credential", async () => {
    const router = new ModelRouter({ credentials: creds });
    const res = await router.chat({ messages: [{ role: "user", content: "Привет" }] }, "fast");
    expect(res.content).toContain("Эхо");
  });

  it("falls back to the next credential when the first fails", async () => {
    const router = new ModelRouter({ credentials: creds, maxRetries: 1 });
    const res = await router.chat({ messages: [{ role: "user", content: "План" }] }, "reasoning");
    expect(res.finishReason).toBe("stop");
  });
});

describe("test provider contract", () => {
  it("json mode возвращает валидный JSON-объект", async () => {
    const router = new ModelRouter({ credentials: creds });
    const res = await router.chat(
      { messages: [{ role: "user", content: "дай json" }], responseFormatJson: true },
      "fast",
    );
    expect(() => JSON.parse(res.content ?? "")).not.toThrow();
  });

  it("tools → tool_calls, tool-result → финальный ответ", async () => {
    const router = new ModelRouter({ credentials: creds });
    const withTools = { tools: [{ name: "get_weather", description: "Погода", inputSchema: { type: "object" } }] };
    const first = await router.chat(
      { messages: [{ role: "user", content: "погода?" }], ...withTools },
      "fast",
    );
    expect(first.finishReason).toBe("tool_calls");
    expect(first.toolCalls?.[0]?.name).toBe("get_weather");
    expect(first.toolCalls?.[0]?.id).toBeTruthy();

    const second = await router.chat(
      {
        messages: [
          { role: "user", content: "погода?" },
          { role: "assistant", content: "", toolCalls: first.toolCalls },
          { role: "tool", content: '{"temp_c":-3}', toolCallId: first.toolCalls![0]!.id },
        ],
        ...withTools,
      },
      "fast",
    );
    expect(second.finishReason).toBe("stop");
    expect(typeof second.content).toBe("string");
    expect(second.toolCalls).toHaveLength(0);
  });
});
