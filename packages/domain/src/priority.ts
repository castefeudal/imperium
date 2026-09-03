export interface PriorityInput {
  deadline?: Date | null;
  blocking?: boolean;
  projectImportance?: number;
  goalRelevance?: number;
  userPreference?: number;
  effortMinutes?: number;
}

export interface PriorityResult {
  score: number;
  band: "critical" | "high" | "medium" | "low";
  why: string[];
}

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

export function computePriority(input: PriorityInput, now: Date): PriorityResult {
  const why: string[] = [];
  let score = 0;

  if (input.deadline) {
    const hoursLeft = (input.deadline.getTime() - now.getTime()) / 3600_000;
    if (hoursLeft <= 0) {
      score += 40;
      why.push("просроченный дедлайн");
    } else if (hoursLeft <= 24) {
      score += 35;
      why.push("дедлайн в течение суток");
    } else if (hoursLeft <= 72) {
      score += 20;
      why.push("дедлайн в течение трёх суток");
    } else {
      score += 5;
    }
  }

  if (input.blocking) {
    score += 25;
    why.push("блокирует другие работы");
    if (input.deadline) {
      const hoursLeft = (input.deadline.getTime() - now.getTime()) / 3600_000;
      if (hoursLeft <= 24) {
        score += 20;
        why.push(`блокирует работу с дедлайном в течение суток (осталось ~${Math.max(0, Math.round(hoursLeft))} ч)`);
      }
    }
  }

  score += clamp((input.projectImportance ?? 0) * 20, 0, 20);
  score += clamp((input.goalRelevance ?? 0) * 15, 0, 15);

  const pref = input.userPreference ?? 0;
  if (pref > 0) {
    score += clamp(pref * 10, 0, 10);
    why.push("явное пользовательское предпочтение");
  }

  score = clamp(Math.round(score));

  const band: PriorityResult["band"] =
    score >= 80 ? "critical" : score >= 60 ? "high" : score >= 35 ? "medium" : "low";

  if (why.length === 0) why.push("нет выраженных факторов срочности");

  return { score, band, why };
}
