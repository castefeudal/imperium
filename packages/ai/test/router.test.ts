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
