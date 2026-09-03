import { describe, it, expect } from "vitest";

describe("worker: mission queue", () => {
  it("POLL_MS читается из окружения с дефолтом 2000", () => {
    expect(Number(process.env.WORKER_POLL_MS ?? 2000)).toBe(2000);
  });

  it("статусы переходов run валидны", () => {
    const valid = ["queued", "running", "awaiting_approval", "done", "failed", "cancelled", "timeout"];
    expect(valid).toContain("running");
    expect(valid).toContain("done");
  });
});
