import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ImperiumClient } from "./client.js";

export const SERVER_INFO = { name: "imperium", version: "1.0.0" } as const;

/** Строит MCP-сервер IMPERIUM. Все операции идут через REST API с bearer-ключом,
 *  поэтому бизнес-логика, workspace-изоляция и аудит остаются в одном месте. */
export function buildImperiumMcpServer(client: ImperiumClient): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.tool(
    "get_today",
    "Сводка на сегодня: приоритетные и просроченные задачи, активные цели, миссии, счётчик inbox",
    {},
    async () => ({ content: [{ type: "text", text: JSON.stringify(await client.getToday(), null, 2) }] }),
  );

  server.tool(
    "search",
    "Полнотекстовый поиск по задачам, заметкам, целям, проектам и знаниям",
    { query: z.string().min(1).describe("Поисковый запрос"), limit: z.number().int().min(1).max(50).optional() },
    async ({ query, limit }) => ({ content: [{ type: "text", text: JSON.stringify(await client.search(query, limit), null, 2) }] }),
  );

  server.tool(
    "create_task",
    "Создать задачу (title, приоритет 1-5, дедлайн, projectId)",
    {
      title: z.string().min(1).max(300),
      priority: z.number().int().min(1).max(5).optional(),
      due: z.string().optional(),
      projectId: z.string().uuid().optional(),
      description: z.string().max(5000).optional(),
      idempotencyKey: z.string().min(8).max(100).optional().describe("Ключ идемпотентности для безопасных ретраев"),
    },
    async (args) => ({ content: [{ type: "text", text: JSON.stringify(await client.createTask(args), null, 2) }] }),
  );

  server.tool(
    "update_task",
    "Обновить задачу (title, priority, due, status, description)",
    {
      id: z.string().uuid(),
      title: z.string().min(1).max(300).optional(),
      priority: z.number().int().min(1).max(5).optional(),
      due: z.string().nullable().optional(),
      status: z.enum(["todo", "in_progress", "done", "cancelled"]).optional(),
      description: z.string().max(5000).nullable().optional(),
    },
    async ({ id, ...patch }) => ({ content: [{ type: "text", text: JSON.stringify(await client.updateTask(id, patch), null, 2) }] }),
  );

  server.tool(
    "complete_task",
    "Отметить задачу выполненной",
    { id: z.string().uuid() },
    async ({ id }) => ({ content: [{ type: "text", text: JSON.stringify(await client.completeTask(id), null, 2) }] }),
  );

  server.tool(
    "create_note",
    "Создать заметку (title, body)",
    {
      title: z.string().min(1).max(300),
      body: z.string().min(1).max(100_000),
      idempotencyKey: z.string().min(8).max(100).optional(),
    },
    async (args) => ({ content: [{ type: "text", text: JSON.stringify(await client.createNote(args), null, 2) }] }),
  );

  server.tool(
    "get_goals",
    "Список целей со связанными проектами и задачами",
    {},
    async () => ({ content: [{ type: "text", text: JSON.stringify(await client.getGoals(), null, 2) }] }),
  );

  server.tool(
    "get_project",
    "Проект по id: статус, связанная цель, задачи",
    { id: z.string().uuid() },
    async ({ id }) => ({ content: [{ type: "text", text: JSON.stringify(await client.getProject(id), null, 2) }] }),
  );

  server.tool(
    "create_mission",
    "Создать миссию агенту (title, goal/prompt, allowedTools)",
    {
      title: z.string().min(1).max(300),
      goal: z.string().min(1).max(20_000),
      allowedTools: z.array(z.string()).optional(),
      idempotencyKey: z.string().min(8).max(100).optional(),
    },
    async (args) => ({ content: [{ type: "text", text: JSON.stringify(await client.createMission(args), null, 2) }] }),
  );

  server.tool(
    "run_mission",
    "Поставить миссию в очередь выполнения (требует scope missions:execute)",
    { id: z.string().uuid() },
    async ({ id }) => ({ content: [{ type: "text", text: JSON.stringify(await client.runMission(id), null, 2) }] }),
  );

  server.tool(
    "get_mission",
    "Статус миссии: статус, шаги, результат, ошибка",
    { id: z.string().uuid() },
    async ({ id }) => ({ content: [{ type: "text", text: JSON.stringify(await client.getMission(id), null, 2) }] }),
  );

  server.tool(
    "capture_inbox",
    "Быстрый захват в inbox (content, optional source)",
    { content: z.string().min(1).max(10_000), source: z.string().max(100).optional() },
    async (args) => ({ content: [{ type: "text", text: JSON.stringify(await client.captureInbox(args), null, 2) }] }),
  );

  server.tool(
    "get_health_summary",
    "Сводка показателей здоровья пользователя (сон, настроение, метрики)",
    {},
    async () => ({ content: [{ type: "text", text: JSON.stringify(await client.getHealthSummary(), null, 2) }] }),
  );

  server.tool(
    "get_context",
    "Компактный операционный контекст: задачи, цели, миссии, недавние заметки",
    {},
    async () => ({ content: [{ type: "text", text: JSON.stringify(await client.getContext(), null, 2) }] }),
  );

  return server;
}
