import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ImperiumClient } from "./client.js";
import { buildImperiumMcpServer } from "./tools.js";

const baseUrl = process.env.IMPERIUM_API_URL ?? "http://127.0.0.1:4000";
const apiKey = process.env.IMPERIUM_API_KEY ?? "";

if (!apiKey) {
  console.error("imperium-mcp: IMPERIUM_API_KEY не задан");
  process.exit(1);
}

const server = buildImperiumMcpServer(new ImperiumClient({ baseUrl, apiKey }));
await server.connect(new StdioServerTransport());
console.error(`imperium-mcp: stdio сервер подключён → ${baseUrl}`);
