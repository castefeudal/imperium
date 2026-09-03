import { describe, it, expect } from "vitest";
import { buildApp } from "../index.js";

describe("API smoke", () => {
  it("health endpoint responds", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    await app.close();
  });

  it("rejects unauthenticated list", async () => {
    const app = await buildApp({ logger: false });
    const res = await app.inject({ method: "GET", url: "/api/v1/tasks" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("registers core routes", async () => {
    const app = await buildApp({ logger: false });
    const paths = app.printRoutes({ commonPrefix: false }) as unknown as string;
    for (const p of ["/api/v1/auth", "/api/v1/tasks", "/api/v1/notes", "/api/v1/missions", "/api/v1/integrations", "/api/v1/decisions"]) {
      expect(paths).toContain(p);
    }
    await app.close();
  });
});
