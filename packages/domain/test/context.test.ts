import { describe, it, expect } from "vitest";
import { selectContext, type ContextCandidate } from "../src/context.js";

const now = new Date("2026-09-03T12:00:00Z");

function cand(p: Partial<ContextCandidate> = {}): ContextCandidate {
  return {
    id: p.id ?? "c1",
    domain: p.domain ?? "work",
    content: p.content ?? "Заметка о проекте",
    createdAt: p.createdAt ?? new Date(now.getTime() - 3600_000),
    importance: p.importance ?? 0.5,
    sensitive: p.sensitive ?? false,
    expiresAt: p.expiresAt ?? null,
  };
}

describe("selectContext", () => {
  it("excludes sensitive domains unless the query explicitly asks", () => {
    const cands = [cand({ id: "h1", domain: "health", sensitive: true, content: "Показатели давления" })];
    const out1 = selectContext("план на день", cands, { tokenBudget: 1000 });
    expect(out1.items).toHaveLength(0);
    const out2 = selectContext("как мой сон и давление", cands, { tokenBudget: 1000, includeSensitive: true });
    expect(out2.items).toHaveLength(1);
  });

  it("filters by active domains", () => {
    const cands = [
      cand({ id: "w1", domain: "work", content: "задача релиза" }),
      cand({ id: "c1", domain: "creator", content: "сценарий Reels" }),
    ];
    const out = selectContext("что по работе", cands, { tokenBudget: 1000, activeDomains: ["work"] });
    expect(out.items.map((i) => i.id)).toEqual(["w1"]);
    expect(out.why.some((w) => /вне активных доменов/.test(w))).toBe(true);
  });

  it("drops expired items", () => {
    const cands = [cand({ id: "old", content: "устарело", expiresAt: new Date(now.getTime() - 1000) })];
    const out = selectContext("напомни", cands, { tokenBudget: 1000, now });
    expect(out.items).toHaveLength(0);
    expect(out.why.some((w) => /истёкший/.test(w))).toBe(true);
  });

  it("respects the token budget and reports usage", () => {
    const cands = [cand({ id: "a", content: "x".repeat(8000) }), cand({ id: "b", content: "y".repeat(8000) })];
    const out = selectContext("собери контекст", cands, { tokenBudget: 300 });
    expect(out.tokenBudgetUsed).toBeLessThanOrEqual(300);
    expect(out.tokenBudget).toBe(300);
  });
});
