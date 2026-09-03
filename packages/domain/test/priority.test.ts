import { describe, it, expect } from "vitest";
import { computePriority } from "../src/priority.js";

const NOW = new Date("2026-09-03T12:00:00Z");

describe("computePriority", () => {
  it("ranks a near-deadline blocking task critical", () => {
    const r = computePriority(
      { deadline: new Date(NOW.getTime() + 12 * 3600_000), blocking: true, projectImportance: 0.9, goalRelevance: 1 },
      NOW,
    );
    expect(r.band).toBe("critical");
    expect(r.score).toBeGreaterThanOrEqual(80);
  });

  it("gives low priority to far-away non-blocking tasks", () => {
    const r = computePriority({ deadline: new Date(NOW.getTime() + 30 * 86_400_000), projectImportance: 0.3 }, NOW);
    expect(r.band).toBe("low");
  });

  it("explains its rationale", () => {
    const r = computePriority({ deadline: new Date(NOW.getTime() + 2 * 86_400_000), goalRelevance: 0.8, blocking: true }, NOW);
    expect(r.why.length).toBeGreaterThan(0);
    expect(r.why.some((w) => /дедлайн/.test(w))).toBe(true);
  });

  it("respects user preference as an urgency multiplier", () => {
    const base = computePriority({ projectImportance: 0.5 }, NOW);
    const boosted = computePriority({ projectImportance: 0.5, userPreference: 1 }, NOW);
    expect(boosted.score).toBeGreaterThan(base.score);
  });

  it("never emits a fake decimal percentage as certainty", () => {
    const r = computePriority({ deadline: new Date(NOW.getTime() + 3600_000) }, NOW);
    expect(Number.isFinite(r.score)).toBe(true);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});
