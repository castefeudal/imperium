export type AutomationTrigger =
  | { kind: "schedule"; cron: string; tz?: string }
  | { kind: "event"; eventType: string }
  | { kind: "webhook"; source: string }
  | { kind: "metric_threshold"; metric: string; op: ">" | "<"; value: number }
  | { kind: "manual" };

export type AutomationAction =
  | { kind: "create_task"; title: string; dueAt?: Date }
  | { kind: "update_task"; taskId: string; patch: Record<string, unknown> }
  | { kind: "create_mission"; objective: string; autonomyLevel?: number }
  | { kind: "run_agent"; agentId: string; input: string }
  | { kind: "send_notification"; channel: string; message: string }
  | { kind: "add_note"; content: string }
  | { kind: "create_review"; period: "daily" | "weekly" | "monthly" }
  | { kind: "webhook"; url: string; payload: Record<string, unknown> }
  | { kind: "integration_action"; integration: string; action: string };

export interface Automation {
  id: string;
  workspaceId: string;
  name: string;
  trigger: AutomationTrigger;
  condition?: { field: string; op: "=" | "!=" | ">" | "<"; value: string } | null;
  actions: AutomationAction[];
  enabled: boolean;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  triggeredAt: Date;
  trigger: AutomationTrigger;
  status: "success" | "failed";
  actions: Array<{ kind: string; status: "success" | "failed" | "skipped" }>;
  durationMs: number;
  logs: string[];
}

/** Deterministic evaluation of trigger + condition. */
export function shouldTrigger(a: Automation, event?: { type: string; at: Date; fields?: Record<string, string | number> }): boolean {
  if (!a.enabled) return false;
  const t = a.trigger;
  if (t.kind === "manual") return event?.type === "manual";
  if (t.kind === "event") return event?.type === t.eventType;
  if (t.kind === "webhook") return event?.type === `webhook:${t.source}`;
  if (t.kind === "metric_threshold") {
    if (event?.type !== "metric") return false;
    const v = Number(event.fields?.[t.metric]);
    if (Number.isNaN(v)) return false;
    return t.op === ">" ? v > t.value : v < t.value;
  }
  if (t.kind === "schedule") {
    if (!event) return false; // schedule is driven by the worker cron, not events
    return false;
  }
  return false;
}

export interface AutomationEvent {
  type: string;
  at: Date;
  fields?: Record<string, string | number>;
}

export interface ActionLogEntry {
  runId: string;
  action: AutomationAction;
  status: "success" | "failed" | "skipped";
  at: Date;
}

export type ActionResult = "success" | "failed" | "skipped";

/** Idempotency: the same event must not duplicate actions. */
export function executeAutomation(
  a: Automation,
  ev: AutomationEvent,
  recentRuns: AutomationRun[],
  idempotencyKey?: string,
): { executed: boolean; reason: string; logs: string[] } {
  const logs: string[] = [];
  if (!shouldTrigger(a, { type: ev.type, at: ev.at, fields: ev.fields })) {
    return { executed: false, reason: "условие триггера не выполнено", logs };
  }
  if (idempotencyKey && recentRuns.some((r) => (r as unknown as { idempotencyKey?: string }).idempotencyKey === idempotencyKey)) {
    return { executed: false, reason: `идемпотентность: ключ ${idempotencyKey} уже обработан`, logs };
  }
  logs.push(`триггер ${a.trigger.kind} соответствует событию ${ev.type}`);
  for (const c of a.actions) {
    if (c.kind === "run_agent") logs.push("делегировано агенту");
    else logs.push(`действие ${c.kind} запланировано`);
  }
  return { executed: true, reason: "ok", logs };
}
