import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { FastifyInstance } from "fastify";
import { ImperiumClient } from "@imperium/mcp/client.js";
import { buildImperiumMcpServer } from "@imperium/mcp/tools.js";

/**
 * MCP HTTP endpoint (Streamable HTTP, stateless). Auth — тот же bearer API-ключ,
 * что и для /v1 (gateway): Authorization: Bearer imp_...
 */
export async function registerMcpRoutes(app: FastifyInstance): Promise<void> {
  app.post("/mcp", async (request, reply) => {
    const auth = request.auth;
    if (!auth || auth.authType !== "api_key") {
      return reply.code(401).send({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Требуется bearer API-ключ IMPERIUM (Authorization: Bearer imp_...)" },
        id: null,
      });
    }
    const client = new ImperiumClient({
      baseUrl: "http://127.0.0.1:" + (process.env.PORT ?? "3100"),
      apiKey: extractBearer(request.headers.authorization),
    });
    const server = buildImperiumMcpServer(client);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (e) {
      app.log.error({ err: e }, "mcp request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "Content-Type": "application/json" });
      }
      reply.raw.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null }));
    } finally {
      await transport.close().catch(() => {});
      await server.close().catch(() => {});
    }
  });

  app.get("/mcp", async (_request, reply) => {
    return reply.code(405).send({
      jsonrpc: "2.0",
      error: { code: -32001, message: "GET не поддерживается stateless-режимом; используйте POST" },
      id: null,
    });
  });

  app.delete("/mcp", async (_request, reply) => {
    return reply.code(405).send({ jsonrpc: "2.0", error: { code: -32001, message: "Сессии не используются" }, id: null });
  });
}

function extractBearer(header: string | undefined): string {
  const m = /^Bearer\s+(.+)$/i.exec(header ?? "");
  const token = m?.[1];
  return typeof token === "string" ? token.trim() : "";
}
