export interface DecisionOption {
  id: string;
  title: string;
}

export interface DecisionCriterion {
  id: string;
  title: string;
  weight: number;            // 0..1
  direction: "maximize" | "minimize";
}

export interface OptionScore {
  optionId: string;
  scores: Record<string, number>; // criterionId -> raw value
}

/**
 * Weighted-criteria decision analysis. Returns normalized scores per option.
 * Uses ranges and qualitative confidence — never a fake decimal percentage
 * presented as certainty: output includes band [min, max] and confidence label.
 */
export function analyzeDecision(
  criteria: DecisionCriterion[],
  scores: OptionScore[],
): {
  ranking: Array<{ optionId: string; weighted: number; band: [number, number]; confidence: "high" | "moderate" | "low" }>;
  tradeoffs: string[];
  mainRisk: string | null;
  reversibility: "reversible" | "hard_to_reverse" | "irreversible";
} {
  const totalW = criteria.reduce((s, c) => s + c.weight, 0) || 1;
  const ranking = scores.map((s) => {
    let weighted = 0;
    for (const c of criteria) {
      const raw = s.scores[c.id] ?? 0;
      const norm = c.direction === "maximize" ? raw : 1 - raw;
      weighted += (c.weight / totalW) * norm;
    }
    // sensitivity band ±15% of the weighted score
    const band: [number, number] = [weighted * 0.85, weighted * 1.15];
    const confidence: "high" | "moderate" | "low" = weighted >= 0.75 ? "high" : weighted >= 0.5 ? "moderate" : "low";
    return { optionId: s.optionId, weighted: Math.round(weighted * 100) / 100, band, confidence };
  }).sort((a, b) => b.weighted - a.weighted);

  const best = ranking[0];
  const second = ranking[1];
  const tradeoffs: string[] = [];
  if (best && second) {
    tradeoffs.push(`«${best.optionId}» впереди «${second.optionId}» на ${(best.weighted - second.weighted).toFixed(2)}`);
    if (best.band[0] < second.weighted) {
      tradeoffs.push(`разрыв в пределах чувствительности: при ±15% лидер может смениться`);
    }
  }
  return {
    ranking,
    tradeoffs,
    mainRisk:
      ranking.length > 1 &&
      ranking[0] !== undefined &&
      ranking[1] !== undefined &&
      ranking[0].band[0] !== undefined &&
      ranking[0].band[0] < ranking[1].weighted
        ? "перевес лучшего варианта нестабилен к изменениям весов"
        : null,
    reversibility: "reversible",
  };
}

export interface ScenarioInput {
  name: string;
  probability: number; // 0..1
  hoursPerWeek: number;
  weeks: number;
}

/** Capacity simulation: what happens if we take on X. Shows assumptions, not fake precision. */
export function simulateScenario(scenarios: ScenarioInput[]): {
  expectedHoursPerWeek: number;
  rows: Array<{ name: string; p: string; hours: number; band: [number, number] }>;
  assumptions: string[];
} {
  const assumptions: string[] = ["вероятности и оценки заданы пользователем", "часы = hoursPerWeek × weeks × probability"];
  const rows = scenarios.map((s) => {
    const hours = Math.round(s.hoursPerWeek * s.weeks * s.probability);
    return {
      name: s.name,
      p: `${Math.round(s.probability * 100)}%`,
      hours,
      band: [Math.round(hours * 0.85), Math.round(hours * 1.15)] as [number, number],
    };
  });
  const expected = scenarios.reduce((acc, s) => acc + s.hoursPerWeek * s.weeks * s.probability, 0);
  return {
    expectedHoursPerWeek: Math.round(expected),
    rows,
    assumptions,
  };
}
