import { describe, expect, it, vi } from "vitest";
import { ImperiumApiError, ImperiumClient } from "../src/client.js";
import { buildImperiumMcpServer, SERVER_INFO } from "../src/tools.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(responder: (method: string, path: string, body?: unknown, idem?: string) => Response) {
  const calls: { method: string; path: string; body?: unknown; idem?: string; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const idem = headers["Idempotency-Key"] ?? undefined;
    const call = {
      method: init?.method ?? "GET",
      path: String(input).replace(/^https?:\/\/[^/]+/, ""),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
      idem,
      headers,
    };
    calls.push(call);
    const pathOnly = call.path.split("?")[0] ?? "";
    const method = call.method;
    const bodyArg = call.body;
    return responder(method, pathOnly, bodyArg, idem);
  });
  const client = new ImperiumClient({ baseUrl: "http://test", apiKey: "imp_test", fetchImpl: fetchImpl as typeof fetch });
  return { client, calls };
}

describe("ImperiumClient", () => {
  it("sends bearer auth and parses JSON", async () => {
    const { client, calls } = makeClient(() => jsonResponse(200, { ok: true }));
    const res = await client.getToday();
    expect(res).toEqual({ ok: true });
    expect(calls[0]!.headers.Authorization).toBe("Bearer imp_test");
    expect(calls[0]!.path).toBe("/api/v1/today");
  });

  it("throws ImperiumApiError with API message on failure", async () => {
    const { client } = makeClient(() => jsonResponse(404, { error: "not found" }));
    await expect(client.getToday()).rejects.toMatchObject({
      constructor: ImperiumApiError,
      status: 404,
      message: "not found",
    });
  });

  it("passes Idempotency-Key through on createTask", async () => {
    const { client, calls } = makeClient(() => jsonResponse(201, { id: "t1" }));
    await client.createTask({ title: "Test", priority: 3, idempotencyKey: "idem-key-12345" });
    expect(calls[0]!.idem).toBe("idem-key-12345");
    expect(calls[0]!.body).toEqual({ title: "Test", priority: 3 });
  });

  it("completeTask patches status done", async () => {
    const { client, calls } = makeClient(() => jsonResponse(200, { status: "done" }));
    await client.completeTask("11111111-1111-1111-1111-111111111111");
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.body).toEqual({ status: "done" });
  });

  it("search builds query string with limit", async () => {
    const { client, calls } = makeClient(() => jsonResponse(200, { results: [] }));
    await client.search("задач", 5);
    expect(calls[0]!.path).toBe("/api/v1/search?q=%D0%B7%D0%B0%D0%B4%D0%B0%D1%87&limit=5");
  });

  it("list unwraps items array", async () => {
    const { client } = makeClient(() => jsonResponse(200, { items: [{ id: "g1" }] }));
    const goals = await client.getGoals();
    expect(goals).toEqual([{ id: "g1" }]);
  });

  it("createMission maps goal to prompt", async () => {
    const { client, calls } = makeClient(() => jsonResponse(201, { id: "m1" }));
    await client.createMission({ title: "T", goal: "do it", allowedTools: ["search"] });
    expect(calls[0]!.body).toEqual({ title: "T", prompt: "do it", allowedTools: ["search"] });
  });
});

describe("MCP server", () => {
  const { Client } = require("@modelcontextprotocol/sdk/client/index.js") as typeof import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js") as typeof import("@modelcontextprotocol/sdk/inMemory.js");

  async function connect() {
    const { client: imperium, calls } = makeClient(() => jsonResponse(200, { ok: true }));
    const server = buildImperiumMcpServer(imperium);
    const mcpClient = new Client({ name: "test-client", version: "0.0.1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
    return { mcpClient, calls };
  }

  it("handshakes with server info", async () => {
    const { mcpClient } = await connect();
    const info = mcpClient.getServerVersion();
    expect(info?.name).toBe(SERVER_INFO.name);
    expect(info?.version).toBe(SERVER_INFO.version);
  });

  it("registers all tools", async () => {
    const { mcpClient } = await connect();
    const tools = await mcpClient.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names.length).toBe(14);
    expect(names).toContain("get_today");
    expect(names).toContain("search");
    expect(names).toContain("create_task");
    expect(names).toContain("complete_task");
  });
});
