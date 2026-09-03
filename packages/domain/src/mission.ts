export const MISSION_STATUSES = [
  "draft", "planning", "awaiting_approval", "queued", "running",
  "blocked", "reviewing", "completed", "failed", "cancelled",
] as const;
export type MissionStatus = (typeof MISSION_STATUSES)[number];

export const STEP_STATUSES = [
  "pending", "running", "awaiting_approval", "completed", "failed", "skipped", "cancelled",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** Legal mission status transitions. Enforced by the runtime and API. */
const TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["awaiting_approval", "queued", "failed", "cancelled"],
  awaiting_approval: ["queued", "cancelled"],
  queued: ["running", "cancelled"],
  running: ["blocked", "reviewing", "completed", "failed", "cancelled"],
  blocked: ["running", "failed", "cancelled"],
  reviewing: ["completed", "running", "failed", "cancelled"],
  completed: [],
  failed: ["queued", "cancelled"],
  cancelled: [],
};

export function canTransition(from: MissionStatus, to: MissionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: MissionStatus, to: MissionStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Недопустимый переход миссии: ${from} → ${to}`);
  }
}

/** Terminal states — no further transitions possible. */
export function isTerminal(s: MissionStatus): boolean {
  return MISSION_STATUSES.indexOf(s) >= MISSION_STATUSES.indexOf("completed") && canTransition(s, "completed") === false && s !== "failed";
}

export type StepVerdict = "PASS" | "PARTIAL" | "FAIL";
export function aggregateVerdicts(vs: StepVerdict[]): StepVerdict {
  if (vs.length === 0) return "FAIL";
  if (vs.every((v) => v === "PASS")) return "PASS";
  if (vs.some((v) => v === "PASS") || vs.some((v) => v === "PARTIAL")) return "PARTIAL";
  return "FAIL";
}

export interface MissionBudget {
  maxSteps: number;
  maxToolCalls: number;
  tokenBudget: number;
  financialBudgetUsd: number;
  maxWallTimeMs: number;
}

export const DEFAULT_BUDGET: MissionBudget = {
  maxSteps: 50,
  maxToolCalls: 200,
  tokenBudget: 400_000,
  financialBudgetUsd: 2,
  maxWallTimeMs: 30 * 60 * 1000,
};

export function budgetExceeded(used: { steps: number; toolCalls: number; tokens: number; usd: number; elapsedMs: number }, b: MissionBudget): string | null {
  if (used.steps >= b.maxSteps) return "max_steps";
  if (used.toolCalls >= b.maxToolCalls) return "max_tool_calls";
  if (used.tokens >= b.tokenBudget) return "token_budget";
  if (used.usd >= b.financialBudgetUsd) return "financial_budget";
  if (used.elapsedMs >= b.maxWallTimeMs) return "wall_time";
  return null;
}
