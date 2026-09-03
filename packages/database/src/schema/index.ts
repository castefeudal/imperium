import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid, integer, boolean, jsonb, real, uniqueIndex, bigint, numeric, primaryKey, vector, doublePrecision } from "drizzle-orm/pg-core";

// ── IDENTITY & ACCESS ─────────────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  locale: text("locale").notNull().default("ru"),
  timezone: text("timezone").notNull().default("Europe/Minsk"),
  mfaSecret: text("mfa_secret"),
  passkeyIds: jsonb("passkey_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id"),
  tokenHash: text("token_hash").notNull(),
  csrfToken: text("csrf_token").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("sessions_user_idx").on(t.userId), index("sessions_token_idx").on(t.tokenHash)]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  ownerId: uuid("owner_id").notNull().references(() => users.id),
  plan: text("plan").notNull().default("free"),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("workspaces_slug_uq").on(t.slug)]);

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"), // owner | admin | member | viewer
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })]);

export const userProfiles = pgTable("user_profiles", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }).primaryKey(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const preferences = pgTable("preferences", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  value: jsonb("value").$type<unknown>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("preferences_user_key_uq").on(t.userId, t.key)]);

// ── MEMORY ────────────────────────────────────────────────────────
export const memories = pgTable("memories", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // identity | preference | goal | constraint | semantic | episodic | procedural | decision | outcome
  content: text("content").notNull(),
  structuredPayload: jsonb("structured_payload").$type<Record<string, unknown>>(),
  sourceType: text("source_type").notNull().default("user"), // user | agent | integration | import | derived
  sourceId: uuid("source_id"),
  confidence: doublePrecision("confidence").notNull().default(0.8),
  importance: doublePrecision("importance").notNull().default(0.5),
  conflictWith: uuid("conflict_with"),
  status: text("status").notNull().default("active"), // active | superseded | archived | blocked
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  userVerified: boolean("user_verified").notNull().default(false),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("memories_ws_type_idx").on(t.workspaceId, t.type),
  index("memories_status_idx").on(t.status),
  index("memories_user_idx").on(t.userId),
]);

export const memorySources = pgTable("memory_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  memoryId: uuid("memory_id").notNull().references(() => memories.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // conversation | document | integration | agent | manual
  reference: text("reference").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("memory_sources_memory_idx").on(t.memoryId)]);

export const entityRelations = pgTable("entity_relations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  sourceEntity: text("source_entity").notNull(),
  sourceId: uuid("source_id").notNull(),
  relationType: text("relation_type").notNull(), // supports | belongs_to | affects | derived_from | blocks | enables | supersedes
  targetEntity: text("target_entity").notNull(),
  targetId: uuid("target_id").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("entity_relations_src_idx").on(t.sourceEntity, t.sourceId), index("entity_relations_dst_idx").on(t.targetEntity, t.targetId)]);

// ── WORK / PRODUCTIVITY ───────────────────────────────────────────
export const areas = pgTable("areas", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  icon: text("icon"),
  color: text("color"),
  module: text("module").notNull().default("work"), // work | life | health | knowledge | creator
  enabled: boolean("enabled").notNull().default(true),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("areas_ws_idx").on(t.workspaceId, t.module)]);

export const goals = pgTable("goals", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  areaId: uuid("area_id").references(() => areas.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"), // draft | active | paused | done | dropped
  priority: integer("priority").notNull().default(3), // 1=highest
  motivation: text("motivation"),
  successMetric: text("success_metric"),
  baseline: text("baseline"),
  target: text("target"),
  targetDate: timestamp("target_date", { withTimezone: true }),
  parentGoalId: uuid("parent_goal_id"),
  progress: doublePrecision("progress").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [index("goals_ws_status_idx").on(t.workspaceId, t.status)]);

export const habits = pgTable("habits", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  schedule: text("schedule"), // cron or "daily"
  streak: integer("streak").notNull().default(0),
  lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const routines = pgTable("routines", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  timeOfDay: text("time_of_day"), // morning | evening
  items: jsonb("items").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  summary: text("summary"),
  owner: uuid("owner_id").notNull().references(() => users.id),
  status: text("status").notNull().default("active"), // planned | active | on_hold | done | cancelled
  priority: integer("priority").notNull().default(3),
  health: text("health").notNull().default("ok"), // ok | attention | at_risk
  startDate: timestamp("start_date", { withTimezone: true }),
  targetDate: timestamp("target_date", { withTimezone: true }),
  progress: doublePrecision("progress").notNull().default(0),
  nextAction: text("next_action"),
  risks: jsonb("risks").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  dependencies: jsonb("dependencies").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  linkedGoals: jsonb("linked_goals").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  linkedMissions: jsonb("linked_missions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  linkedDocuments: jsonb("linked_documents").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("projects_ws_status_idx").on(t.workspaceId, t.status)]);

export const milestones = pgTable("milestones", {
  id: uuid("id").defaultRandom().primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  order: integer("order").notNull().default(0),
});

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
  assignee: uuid("assignee").references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("inbox"), // inbox | today | upcoming | backlog | blocked | in_progress | review | done | cancelled
  priority: integer("priority").notNull().default(3),
  rank: doublePrecision("rank").notNull().default(0), // computed by priority engine
  dueAt: timestamp("due_at", { withTimezone: true }),
  startAt: timestamp("start_at", { withTimezone: true }),
  estimate: integer("estimate"), // minutes
  actual: integer("actual"),
  tags: jsonb("tags").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  dependencies: jsonb("dependencies").$type<string[]>().notNull().default(sql`'[]'::jsonb`), // task ids
  recurrence: text("recurrence"), // RRULE
  source: text("source").notNull().default("user"), // user | command | mission | automation | integration | import
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("tasks_ws_status_idx").on(t.workspaceId, t.status),
  index("tasks_due_idx").on(t.dueAt),
  index("tasks_rank_idx").on(t.rank),
  index("tasks_project_idx").on(t.projectId),
]);

export const taskDependencies = pgTable("task_dependencies", {
  taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  dependsOnTaskId: uuid("depends_on_task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("finish_to_start"),
}, (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })]);

// ── AGENT RUNTIME ─────────────────────────────────────────────────
export const missions = pgTable("missions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  objective: text("objective").notNull(),
  status: text("status").notNull().default("draft"), // draft | planning | awaiting_approval | queued | running | blocked | reviewing | completed | failed | cancelled
  priority: integer("priority").notNull().default(3),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  plannerAgent: uuid("planner_agent"),
  budget: jsonb("budget").$type<{ maxSteps?: number; maxWallTimeSec?: number; maxTokenUsd?: number; maxToolCalls?: number }>(),
  maxSteps: integer("max_steps").notNull().default(50),
  deadline: timestamp("deadline", { withTimezone: true }),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  allowedTools: jsonb("allowed_tools").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  autonomyLevel: integer("autonomy_level").notNull().default(2), // 0..5
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  attempt: integer("attempt").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("missions_ws_status_idx").on(t.workspaceId, t.status)]);

export const missionSteps = pgTable("mission_steps", {
  id: uuid("id").defaultRandom().primaryKey(),
  missionId: uuid("mission_id").notNull().references(() => missions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  agent: uuid("agent"),
  dependencies: jsonb("dependencies").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("pending"), // pending | ready | running | done | failed | skipped | awaiting_approval
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  toolPolicy: jsonb("tool_policy").$type<{ allowed: string[]; denied: string[]; maxRisk: string }>(),
  input: jsonb("input").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  verification: jsonb("verification").$type<{ verdict: string; confidence: number; checked: string[] }>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const agentDefinitions = pgTable("agent_definitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").notNull(), // generalist | researcher | planner | analyst | builder | reviewer | qa | writer | creator | project_manager | evidence_researcher | health_analyst
  description: text("description"),
  systemInstructions: text("system_instructions").notNull(),
  modelProfile: text("model_profile").notNull().default("fast"), // fast | reasoning | coding | vision | embedding | fallback
  tools: jsonb("tools").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  memoryPolicy: jsonb("memory_policy").$type<{ read: boolean; write: boolean; scope: string }>(),
  maxSteps: integer("max_steps").notNull().default(50),
  budget: jsonb("budget").$type<{ maxTokenUsd?: number; maxWallTimeSec?: number }>(),
  temperature: real("temperature").notNull().default(0.7),
  reasoningProfile: text("reasoning_profile"),
  approvalPolicy: jsonb("approval_policy").$type<{ autoApproveRisks: string[]; alwaysApprove: string[] }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  missionId: uuid("mission_id").references(() => missions.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").references(() => missionSteps.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").references(() => agentDefinitions.id),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"), // queued | running | awaiting_approval | done | failed | cancelled | timeout
  attempt: integer("attempt").notNull().default(0),
  maxSteps: integer("max_steps").notNull().default(50),
  budget: jsonb("budget").$type<{ maxTokenUsd?: number; maxWallTimeSec?: number }>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  error: text("error"),
  idempotencyKey: text("idempotency_key"),
}, (t) => [index("agent_runs_mission_idx").on(t.missionId), index("agent_runs_status_idx").on(t.status), uniqueIndex("agent_runs_idem_uq").on(t.idempotencyKey)]);

export const agentMessages = pgTable("agent_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // system | user | assistant | tool
  content: text("content").notNull(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("agent_messages_run_idx").on(t.runId)]);

export const toolCalls = pgTable("tool_calls", {
  id: uuid("id").defaultRandom().primaryKey(),
  runId: uuid("run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
  missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
  tool: text("tool").notNull(),
  riskLevel: text("risk_level").notNull(), // READ | INTERNAL_WRITE | EXTERNAL_WRITE | SENSITIVE | DESTRUCTIVE
  requiredScopes: jsonb("required_scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  inputSummary: jsonb("input_summary").$type<Record<string, unknown>>(),
  resultSummary: jsonb("result_summary").$type<Record<string, unknown>>(),
  status: text("status").notNull(), // pending | approved | rejected | done | failed | timeout
  approval: uuid("approval"),
  durationMs: integer("duration_ms"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("tool_calls_run_idx").on(t.runId), uniqueIndex("tool_calls_idem_uq").on(t.idempotencyKey)]);

export const approvals = pgTable("approvals", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
  stepId: uuid("step_id").references(() => missionSteps.id, { onDelete: "set null" }),
  toolCallId: uuid("tool_call_id").references(() => toolCalls.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // tool_call | external_write | destructive | publication | sensitive
  title: text("title").notNull(),
  why: text("why"),
  risks: jsonb("risks").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("pending"), // pending | approved_once | approved_for_mission | rejected | expired
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  decidedBy: uuid("decided_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("approvals_ws_status_idx").on(t.workspaceId, t.status)]);

// ── AUTOMATIONS ───────────────────────────────────────────────────
export const automations = pgTable("automations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  trigger: jsonb("trigger").$type<{ kind: string; cron?: string; event?: string; metric?: { name: string; op: string; value: number }; integration?: string }>().notNull(),
  condition: jsonb("condition").$type<{ all?: unknown[]; any?: unknown[]; not?: unknown }>(),
  action: jsonb("action").$type<{ kind: string; params: Record<string, unknown> }>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  automationId: uuid("automation_id").notNull().references(() => automations.id, { onDelete: "cascade" }),
  triggerPayload: jsonb("trigger_payload").$type<Record<string, unknown>>(),
  status: text("status").notNull(), // triggered | success | failed | skipped
  actions: jsonb("actions").$type<{ kind: string; status: string; result?: unknown }[]>(),
  durationMs: integer("duration_ms"),
  logs: jsonb("logs").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  retryOf: uuid("retry_of"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("automation_runs_automation_idx").on(t.automationId, t.startedAt)]);

// ── INBOX & NOTIFICATIONS ─────────────────────────────────────────
export const inboxItems = pgTable("inbox_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(), // system | email | telegram | github | agent | automation | integration
  category: text("category").notNull().default("fyi"), // decision | action | waiting | fyi | ignore
  importance: doublePrecision("importance").notNull().default(0.5),
  title: text("title").notNull(),
  body: text("body"),
  entityRef: jsonb("entity_ref").$type<{ entity: string; id: string }>(),
  sourceRef: jsonb("source_ref").$type<Record<string, unknown>>(),
  readAt: timestamp("read_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("inbox_ws_category_idx").on(t.workspaceId, t.category), index("inbox_importance_idx").on(t.importance)]);

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // action_required | agent | deadline | automation | integration | system
  title: text("title").notNull(),
  body: text("body"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  readAt: timestamp("read_at", { withTimezone: true }),
  snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  quietUntil: timestamp("quiet_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("notifications_user_kind_idx").on(t.userId, t.kind)]);

// ── INTEGRATIONS ──────────────────────────────────────────────────
export const integrations = pgTable("integrations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // github | telegram | gmail | google_calendar | ticktick | notion | mcp | webhook | openai_compatible
  label: text("label"),
  status: text("status").notNull().default("disconnected"), // connected | disconnected | error | expired
  permissions: jsonb("permissions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("integrations_ws_kind_uq").on(t.workspaceId, t.kind)]);

export const integrationCredentials = pgTable("integration_credentials", {
  id: uuid("id").defaultRandom().primaryKey(),
  integrationId: uuid("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  provider: text("provider").notNull(),
  encryptedToken: text("encrypted_token").notNull(),
  baseUrl: text("base_url"),
  scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  status: text("status").notNull().default("active"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrationSyncState = pgTable("integration_sync_state", {
  integrationId: uuid("integration_id").notNull().references(() => integrations.id, { onDelete: "cascade" }).primaryKey(),
  resource: text("resource").notNull(),
  cursor: text("cursor"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  state: jsonb("state").$type<Record<string, unknown>>(),
});

// ── KNOWLEDGE ─────────────────────────────────────────────────────
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull().default("upload"), // upload | url | integration | generated | agent_artifact
  sourceRef: jsonb("source_ref").$type<Record<string, unknown>>(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  provenance: jsonb("provenance").$type<{ kind: string; generatedBy?: string; model?: string; provider?: string; generatedAt?: string; sourceEntities?: unknown[] }>(),
  aiGenerated: boolean("ai_generated").notNull().default(false),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("documents_ws_idx").on(t.workspaceId)]);

export const documentChunks = pgTable("document_chunks", {
  id: uuid("id").defaultRandom().primaryKey(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count"),
  section: text("section"),
  page: integer("page"),
  embedding: vector("embedding", { dimensions: 1536 }),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("document_chunks_doc_seq_idx").on(t.documentId, t.seq),
  index("document_chunks_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
]);

export const notes = pgTable("notes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  body: text("body").notNull(),
  links: jsonb("links").$type<{ entity: string; id: string }[]>().notNull().default(sql`'[]'::jsonb`),
  trashedAt: timestamp("trashed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  declaredMime: text("declared_mime"),
  mimeMismatch: boolean("mime_mismatch").notNull().default(false),
  parseError: text("parse_error"),
  scanStatus: text("scan_status").notNull().default("pending"), // pending | clean | infected | error
  documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── EVIDENCE ──────────────────────────────────────────────────────
export const claims = pgTable("claims", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(), // general | health | science | product | finance
  statement: text("statement").notNull(),
  status: text("status").notNull().default("open"), // open | evaluating | verified | partially_verified | refuted | inconclusive
  verdict: text("verdict"),
  confidence: doublePrecision("confidence"),
  evidenceQuality: doublePrecision("evidence_quality"),
  limitations: jsonb("limitations").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  contradictions: jsonb("contradictions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  whatCouldChange: jsonb("what_could_change").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  assumptions: jsonb("assumptions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evidenceSources = pgTable("evidence_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // pubmed | crossref | semantic_scholar | web | mcp | document | experiment | user
  adapter: text("adapter"),
  title: text("title").notNull(),
  authors: jsonb("authors").$type<string[]>(),
  publication: text("publication"),
  year: integer("year"),
  doi: text("doi"),
  pmid: text("pmid"),
  url: text("url"),
  tier: text("tier").notNull().default("expert_opinion"), // systematic_review | meta_analysis | rct | prospective_cohort | observational | case_report | mechanistic | expert_opinion
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
}, (t) => [index("evidence_ws_kind_idx").on(t.workspaceId, t.kind)]);

export const claimEvidence = pgTable("claim_evidence", {
  claimId: uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
  evidenceId: uuid("evidence_id").notNull().references(() => evidenceSources.id, { onDelete: "cascade" }),
  stance: text("stance").notNull().default("supports"), // supports | contradicts | neutral
  weight: doublePrecision("weight").notNull().default(0.5),
  note: text("note"),
}, (t) => [primaryKey({ columns: [t.claimId, t.evidenceId] })]);

// ── HEALTH ────────────────────────────────────────────────────────
export const healthEntries = pgTable("health_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // weight | waist | body_fat | workout | meal | sleep | recovery | lab | symptom | intervention | note
  value: doublePrecision("value"),
  unit: text("unit"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  sourceType: text("source_type").notNull().default("manual"), // manual | import | agent | integration | device
  confidence: doublePrecision("confidence").notNull().default(1),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("health_ws_kind_idx").on(t.workspaceId, t.kind), index("health_recorded_idx").on(t.recordedAt)]);

export const bodyMeasurements = pgTable("body_measurements", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  weightKg: doublePrecision("weight_kg"),
  waistCm: doublePrecision("waist_cm"),
  bodyFatPct: doublePrecision("body_fat_pct"),
  photosMetadata: jsonb("photos_metadata").$type<Record<string, unknown>>(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
});

export const workouts = pgTable("workouts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  durationSec: integer("duration_sec"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const exercises = pgTable("exercises", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull().unique(),
  muscleGroups: jsonb("muscle_groups").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  equipment: text("equipment"),
});

export const workoutSets = pgTable("workout_sets", {
  id: uuid("id").defaultRandom().primaryKey(),
  workoutId: uuid("workout_id").notNull().references(() => workouts.id, { onDelete: "cascade" }),
  exerciseId: uuid("exercise_id").notNull().references(() => exercises.id),
  weightKg: doublePrecision("weight_kg"),
  reps: integer("reps"),
  rpe: doublePrecision("rpe"),
  rir: doublePrecision("rir"),
  notes: text("notes"),
}, (t) => [index("workout_sets_workout_idx").on(t.workoutId)]);

export const nutritionEntries = pgTable("nutrition_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  meal: text("meal"), // breakfast | lunch | dinner | snack
  kcal: real("kcal"),
  proteinG: real("protein_g"),
  fatG: real("fat_g"),
  carbsG: real("carbs_g"),
  bodyweightKg: real("bodyweight_kg"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  notes: text("notes"),
}, (t) => [index("nutrition_ws_idx").on(t.workspaceId, t.recordedAt)]);

export const sleepEntries = pgTable("sleep_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  bedAt: timestamp("bed_at", { withTimezone: true }),
  wokeAt: timestamp("woke_at", { withTimezone: true }),
  durationSec: integer("duration_sec"),
  quality: integer("quality"), // 1..5 subjective
  restingHr: doublePrecision("resting_hr"),
  hrvMs: doublePrecision("hrv_ms"),
  stress: integer("stress"),
  recovery: integer("recovery"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
}, (t) => [index("sleep_ws_idx").on(t.workspaceId, t.recordedAt)]);

export const recoveryEntries = pgTable("recovery_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  restingHr: doublePrecision("resting_hr"),
  hrvMs: doublePrecision("hrv_ms"),
  stress: integer("stress"),
  recovery: integer("recovery"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
});

export const labResults = pgTable("lab_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  marker: text("marker").notNull(),
  value: numeric("value"),
  unit: text("unit"),
  referenceRange: text("reference_range"),
  interpretation: text("interpretation"), // never a diagnosis — reference context only
  date: timestamp("date", { withTimezone: true }).notNull(),
  lab: text("lab"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("labs_ws_marker_idx").on(t.workspaceId, t.marker)]);

export const symptoms = pgTable("symptoms", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  severity: integer("severity"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const interventions = pgTable("interventions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // supplement | medication | protocol | diet | training_program
  name: text("name").notNull(),
  dosage: text("dosage"),
  schedule: text("schedule"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── CREATOR ───────────────────────────────────────────────────────
export const contentItems = pgTable("content_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  platform: text("platform").notNull(), // youtube | telegram | linkedin | x | newsletter | article | short | reel | tiktok | generic
  format: text("format").notNull().default("post"), // post | short | long | article | script | newsletter
  pillar: text("pillar"),
  status: text("status").notNull().default("idea"), // idea | research | brief | script | production | review | scheduled | published | archived
  hook: text("hook"),
  script: text("script"),
  cta: text("cta"),
  sources: jsonb("sources").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  relatedClaims: jsonb("related_claims").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  externalUrl: text("external_url"),
  metrics: jsonb("metrics").$type<{ views?: number; reach?: number; watchTimeSec?: number; completion?: number; likes?: number; comments?: number; shares?: number; saves?: number; conversions?: number }>(),
  repurposedFrom: jsonb("repurposed_from").$type<{ entity: string; id: string }[]>(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("content_ws_platform_idx").on(t.workspaceId, t.platform), index("content_status_idx").on(t.status)]);

export const contentMetrics = pgTable("content_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  contentId: uuid("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  sourceType: text("source_type").notNull().default("manual"), // manual | import | api
  payload: jsonb("payload").$type<Record<string, number | string>>(),
}, (t) => [index("content_metrics_content_idx").on(t.contentId, t.recordedAt)]);

// ── DECISIONS ─────────────────────────────────────────────────────
export const decisions = pgTable("decisions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  objective: text("objective"),
  constraints: jsonb("constraints").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  assumptions: jsonb("assumptions").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  evidence: jsonb("evidence").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  outcome: text("outcome"),
  chosenOptionId: uuid("chosen_option_id"),
  confidence: doublePrecision("confidence"),
  reversible: text("reversible").notNull().default("reversible"), // reversible | partially_reversible | irreversible
  status: text("status").notNull().default("open"), // open | analyzed | decided | closed
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const decisionOptions = pgTable("decision_options", {
  id: uuid("id").defaultRandom().primaryKey(),
  decisionId: uuid("decision_id").notNull().references(() => decisions.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  cost: text("cost"),
  time: text("time"),
  effect: text("effect"),
  risk: text("risk"),
  reversible: text("reversible"),
  confidence: doublePrecision("confidence"),
  sensitivity: jsonb("sensitivity").$type<Record<string, unknown>>(),
  score: doublePrecision("score"),
});

export const decisionCriteria = pgTable("decision_criteria", {
  id: uuid("id").defaultRandom().primaryKey(),
  decisionId: uuid("decision_id").notNull().references(() => decisions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  weight: doublePrecision("weight").notNull().default(1),
});

export const decisionOutcomes = pgTable("decision_outcomes", {
  id: uuid("id").defaultRandom().primaryKey(),
  decisionId: uuid("decision_id").notNull().references(() => decisions.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  result: text("result").notNull(), // success | partial | failure | unknown
  notes: text("notes"),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
});

// ── EXPERIMENTS ───────────────────────────────────────────────────
export const experiments = pgTable("experiments", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  hypothesis: text("hypothesis").notNull(),
  domain: text("domain").notNull(), // productivity | health | content | marketing | product | habits
  baseline: text("baseline"),
  intervention: text("intervention"),
  primaryMetric: text("primary_metric").notNull(),
  secondaryMetrics: jsonb("secondary_metrics").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  durationDays: integer("duration_days"),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),
  confounders: jsonb("confounders").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  stopRule: text("stop_rule"),
  status: text("status").notNull().default("planned"), // planned | running | completed | stopped | inconclusive
  result: text("result"), // confirmed | partially | not_confirmed | inconclusive
  confidence: doublePrecision("confidence"),
  effect: text("effect"),
  uncertainty: text("uncertainty"),
  limitations: jsonb("limitations").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  nextAction: text("next_action"),
  observations: jsonb("observations").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const experimentMetrics = pgTable("experiment_metrics", {
  id: uuid("id").defaultRandom().primaryKey(),
  experimentId: uuid("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
  metric: text("metric").notNull(),
  value: doublePrecision("value"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
}, (t) => [index("experiment_metrics_exp_idx").on(t.experimentId)]);

export const experimentObservations = pgTable("experiment_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  experimentId: uuid("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
}, (t) => [index("experiment_obs_exp_idx").on(t.experimentId)]);

// ── PEOPLE ────────────────────────────────────────────────────────
export const people = pgTable("people", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  organization: text("organization"),
  role: text("role"),
  contacts: jsonb("contacts").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  notes: text("notes"),
  linkedProjectIds: jsonb("linked_project_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
  followUpAt: timestamp("follow_up_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("people_ws_idx").on(t.workspaceId)]);

// ── REVIEWS ───────────────────────────────────────────────────────
export const reviews = pgTable("reviews", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // daily | weekly | monthly
  planned: jsonb("planned").$type<Record<string, unknown>>(),
  done: jsonb("done").$type<Record<string, unknown>>(),
  moved: jsonb("moved").$type<unknown[]>(),
  blocked: jsonb("blocked").$type<unknown[]>(),
  achievement: text("achievement"),
  mood: integer("mood"),
  next: jsonb("next").$type<Record<string, unknown>>(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("reviews_ws_kind_idx").on(t.workspaceId, t.kind)]);

// ── API KEYS / WEBHOOKS / AUDIT / COST ────────────────────────────
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'[]'::jsonb`), // read:tasks write:tasks read:projects create:missions read:knowledge ...
  keyHash: text("key_hash").notNull(),
  keyPreview: text("key_preview").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("api_keys_ws_idx").on(t.workspaceId)]);

export const webhooks = pgTable("webhooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default("outgoing"), // incoming | outgoing
  url: text("url").notNull(),
  secret: text("secret"),
  events: jsonb("events").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  webhookId: uuid("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>(),
  signature: text("signature"),
  status: integer("status"),
  attempt: integer("attempt").notNull().default(0),
  responseMs: integer("response_ms"),
  error: text("error"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("webhook_deliveries_webhook_idx").on(t.webhookId, t.deliveredAt)]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id"),
  userId: uuid("user_id"),
  agentId: uuid("agent_id"),
  action: text("action").notNull(),
  entity: text("entity"),
  entityId: text("entity_id"),
  diff: jsonb("diff").$type<{ from?: unknown; to?: unknown }>(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("audit_ws_action_idx").on(t.workspaceId, t.action), index("audit_user_idx").on(t.userId), index("audit_entity_idx").on(t.entity, t.entityId)]);

export const costLedger = pgTable("cost_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  missionId: uuid("mission_id").references(() => missions.id, { onDelete: "set null" }),
  agentId: uuid("agent_id").references(() => agentDefinitions.id),
  runId: uuid("run_id"),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  estCostUsd: numeric("est_cost_usd", { precision: 12, scale: 6 }),
  kind: text("kind").notNull().default("completion"), // completion | embedding | tool
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("cost_ws_recorded_idx").on(t.workspaceId, t.recordedAt), index("cost_mission_idx").on(t.missionId)]);
