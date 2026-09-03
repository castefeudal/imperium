export type EvidenceTier =
  | "systematic_review"
  | "meta_analysis"
  | "rct"
  | "prospective_cohort"
  | "observational"
  | "case_report"
  | "mechanistic"
  | "expert_opinion"
  | "unknown";

export const TIER_WEIGHTS: Record<EvidenceTier, number> = {
  systematic_review: 1.0,
  meta_analysis: 0.95,
  rct: 0.85,
  prospective_cohort: 0.65,
  observational: 0.45,
  case_report: 0.2,
  mechanistic: 0.3,
  expert_opinion: 0.15,
  unknown: 0.1,
};

export type Verdict = "confirmed" | "likely_confirmed" | "unclear" | "likely_refuted" | "refuted" | "insufficient_data";
export type Confidence = "high" | "moderate" | "low" | "insufficient_data";

export const VERDICT_LABELS_RU: Record<Verdict, string> = {
  confirmed: "Подтверждается",
  likely_confirmed: "Скорее подтверждается",
  unclear: "Неоднозначно",
  likely_refuted: "Скорее опровергается",
  refuted: "Опровергается",
  insufficient_data: "Недостаточно данных",
};

export const CONFIDENCE_LABELS_RU: Record<Confidence, string> = {
  high: "Высокая",
  moderate: "Умеренная",
  low: "Низкая",
  insufficient_data: "Недостаточно данных",
};

export type Stance = "supports" | "contradicts" | "neutral" | "unclear";

export interface EvidenceItem {
  tier: EvidenceTier;
  /** Направление результата источника относительно утверждения. */
  stance?: Stance;
  /** Backward-compatible boolean: true = supports, false = contradicts. */
  supports?: boolean;
  sampleSize?: number | null;
  year?: number | null;
  retracted?: boolean;
  conflictsWithPrior?: boolean;
}

/** Evidence quality score in [0..1]. Retracted sources score 0. */
export function evidenceQuality(items: EvidenceItem[]): number {
  if (items.length === 0) return 0;
  const valid = items.filter((i) => !i.retracted);
  if (valid.length === 0) return 0;
  // top-3 weighted: strongest evidence dominates
  const sorted = valid.map((i) => {
    let w = TIER_WEIGHTS[i.tier];
    if (i.sampleSize) w *= i.sampleSize >= 1000 ? 1 : i.sampleSize >= 100 ? 0.9 : i.sampleSize >= 30 ? 0.75 : 0.5;
    if (i.year && i.year < new Date().getFullYear() - 20) w *= 0.85;
    return w;
  }).sort((a, b) => b - a);
  const top = sorted.slice(0, 3);
  const avg = top.reduce((s, w) => s + w, 0) / top.length;
  const breadth = Math.min(1, valid.length / 5);
  return Math.round(Math.min(1, avg * 0.8 + breadth * 0.2) * 100) / 100;
}

/**
 * Synthesize verdict + confidence from evidence items.
 * Never fabricates certainty: low-quality or thin evidence → "insufficient_data"/"unclear".
 */
export function synthesizeVerdict(items: EvidenceItem[]): { verdict: Verdict; confidence: Confidence; rationale: string[] } {
  if (items.length === 0) {
    return { verdict: "insufficient_data", confidence: "insufficient_data", rationale: ["нет источников"] };
  }
  const stanceOf = (i: EvidenceItem): "supports" | "contradicts" | "unclear" => {
    if (i.stance) return i.stance === "neutral" || i.stance === "unclear" ? "unclear" : i.stance;
    if (i.supports === true) return "supports";
    if (i.supports === false) return "contradicts";
    return "unclear";
  };
  const supporting = items.filter((i) => stanceOf(i) === "supports" && !i.retracted);
  const opposing = items.filter((i) => stanceOf(i) === "contradicts" && !i.retracted);
  const unclear = items.filter((i) => stanceOf(i) === "unclear" && !i.retracted);
  const q = evidenceQuality(items);
  const rationale: string[] = [];

  let verdict: Verdict;
  if (supporting.length === 0 && opposing.length === 0) {
    if (unclear.length > 0) {
      return { verdict: "insufficient_data", confidence: "insufficient_data", rationale: ["направление результатов источников не определено (только метаданные)"] };
    }
    return { verdict: "insufficient_data", confidence: "insufficient_data", rationale: ["все источники отозваны или непригодны"] };
  }
  const sQ = evidenceQuality(supporting);
  const oQ = evidenceQuality(opposing);
  rationale.push(`качество supporting=${sQ}, opposing=${oQ}`);

  if (sQ > oQ * 1.5 && sQ >= 0.5) verdict = "likely_confirmed";
  else if (oQ > sQ * 1.5 && oQ >= 0.5) verdict = "likely_refuted";
  else if (sQ === 0 && oQ > 0) verdict = "likely_refuted";
  else if (oQ === 0 && sQ > 0) verdict = "likely_confirmed";
  else verdict = "unclear";

  if (verdict === "likely_confirmed" && sQ >= 0.8 && supporting.length >= 3) verdict = "confirmed";
  if (verdict === "likely_refuted" && oQ >= 0.8 && opposing.length >= 3) verdict = "refuted";

  const confidence: Confidence = q >= 0.75 && items.length >= 5 ? "high" : q >= 0.5 ? "moderate" : q > 0.15 ? "low" : "insufficient_data";
  if (items.some((i) => i.retracted)) rationale.push("часть источников отозвана и исключена");
  if (items.some((i) => i.conflictsWithPrior)) rationale.push("есть противоречия между источниками");
  if (q < 0.5) rationale.push("преобладают слабые уровни доказательности");
  return { verdict, confidence, rationale };
}
