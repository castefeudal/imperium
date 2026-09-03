export type RiskLevel = "READ" | "INTERNAL_WRITE" | "EXTERNAL_WRITE" | "SENSITIVE" | "DESTRUCTIVE";

export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  0: "Только отвечает",
  1: "Рекомендует",
  2: "Готовит планы",
  3: "Выполняет безопасное",
  4: "Автономные рутины",
  5: "Высокая автономность",
};

/** Actions that always require explicit approval, regardless of level. */
export const HARD_APPROVAL_ACTIONS = [
  "bulk_delete",
  "send_external_message",
  "production_deploy",
  "merge_critical_pr",
  "change_access_controls",
  "financial_transaction",
  "medical_decision",
  "publish_public_content",
  "destructive_shell",
] as const;
export type HardApprovalAction = (typeof HARD_APPROVAL_ACTIONS)[number];

export interface ToolPolicy {
  risk: RiskLevel;
  action?: HardApprovalAction;
}

export interface ApprovalDecision {
  required: boolean;
  reason: string;
}

/**
 * Autonomy policy: decides if a tool call needs approval.
 * Level 0-2: never execute tools autonomously (READ only from L3).
 * Level 3: READ + INTERNAL_WRITE auto.
 * Level 4: + EXTERNAL_WRITE via pre-approved workflow (still not SENSITIVE/DESTRUCTIVE).
 * Level 5: everything except HARD_APPROVAL_ACTIONS and DESTRUCTIVE.
 */
export function requiresApproval(tool: ToolPolicy, level: AutonomyLevel, preApproved?: Set<string>): ApprovalDecision {
  if (tool.action && HARD_APPROVAL_ACTIONS.includes(tool.action)) {
    if (preApproved?.has(tool.action)) return { required: false, reason: "действие явно разрешено policy для этой mission" };
    return { required: true, reason: `жёсткая граница безопасности: ${tool.action}` };
  }
  switch (tool.risk) {
    case "READ":
      return level >= 3
        ? { required: false, reason: "безопасное чтение" }
        : { required: true, reason: `уровень автономности ${level} не позволяет выполнять инструменты` };
    case "INTERNAL_WRITE":
      if (level >= 3) return { required: false, reason: "внутренняя запись разрешена на уровне 3+" };
      return { required: true, reason: `уровень ${level}: внутренние изменения требуют подтверждения` };
    case "EXTERNAL_WRITE":
      if (level >= 4 && preApproved?.has(tool.action ?? tool.risk)) return { required: false, reason: "внешняя запись разрешена policy" };
      return { required: true, reason: "изменение внешнего сервиса требует подтверждения" };
    case "SENSITIVE":
      return { required: true, reason: "чувствительное действие (публикации, production, merge)" };
    case "DESTRUCTIVE":
      return { required: true, reason: "необратимое действие — подтверждение обязательно" };
  }
}
