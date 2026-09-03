export type MemoryType = "identity" | "preference" | "goal" | "constraint" | "semantic" | "episodic" | "procedural" | "decision" | "outcome";

export interface MemoryInput {
  id?: string;
  workspaceId: string;
  userId: string;
  type: MemoryType;
  content: string;
  structuredPayload?: Record<string, unknown> | null;
  sourceType?: "user" | "agent" | "integration" | "import" | "derived";
  sourceId?: string | null;
  confidence?: number;
  importance?: number;
  provenance?: { kind: string; reference?: string; generatedBy?: string; generatedAt?: Date } | null;
  conflictWith?: string | null;
  userVerified?: boolean;
  validFrom?: Date;
  expiresAt?: Date | null;
  now?: Date;
}

export interface MemoryRank {
  recency: number;
  relevance: number;
  importance: number;
  confidence: number;
  score: number;
  why: string[];
}

const W = { recency: 0.3, relevance: 0.35, importance: 0.25, confidence: 0.1 } as const;
const HALF_LIFE_DAYS = 30;

export function recencyFactor(createdAt: Date, now: Date, halfLifeDays = HALF_LIFE_DAYS): number {
  const days = Math.max(0, (now.getTime() - createdAt.getTime()) / 86_400_000);
  return Math.exp((-Math.LN2 * days) / halfLifeDays);
}

/** Lexical overlap relevance (BM25-lite). Deterministic, no embeddings required. */
export function lexicalRelevance(query: string, content: string): number {
  const norm = (s: string) => s.toLowerCase().split(/[\s,.:;!?«»"'()\[\]{}]+/).filter((w) => w.length > 2);
  const q = [...new Set(norm(query))];
  const c = norm(content);
  if (q.length === 0) return 0;
  let hits = 0;
  for (const w of q) if (c.includes(w)) hits++;
  const coverage = hits / q.length;
  const density = Math.min(1, hits / Math.max(1, Math.min(50, Math.ceil(c.length / 12))));
  return Math.min(1, 0.7 * coverage + 0.3 * density);
}

/**
 * Explainable memory ranking: score in [0..100].
 * score = 100 * (W.recency*recency + W.relevance*relevance + W.importance*importance + W.confidence*confidence)
 */
export function rankMemory(m: MemoryInput, relevance: number, now: Date): MemoryRank {
  const recency = recencyFactor(m.validFrom ?? m.now ?? now, now);
  const importance = m.importance ?? 0.5;
  const confidence = m.confidence ?? 0.8;
  const score =
    100 * (W.recency * recency + W.relevance * relevance + W.importance * importance + W.confidence * confidence);
  const why: string[] = [];
  if (recency < 0.2) why.push("память старая (полураспад 30 дн.)");
  if (relevance < 0.2) why.push("слабое совпадение с запросом");
  if (importance < 0.3) why.push("низкая важность");
  if (confidence < 0.5) why.push("низкая уверенность источника");
  if (why.length === 0) why.push("все факторы в норме");
  return {
    recency: Math.round(recency * 100) / 100,
    relevance: Math.round(relevance * 100) / 100,
    importance,
    confidence,
    score: Math.round(score * 100) / 100,
    why,
  };
}

/** Memory conflict resolution: replacement, temporal validity, superseded state. */
export function resolveConflict<T extends { type: MemoryType; validFrom: Date; content: string; id: string }>(
  incoming: T,
  existing: T,
): "replace" | "coexist" | "reject" {
  if (incoming.type !== existing.type) return "coexist";
  const newer = incoming.validFrom.getTime() >= existing.validFrom.getTime();
  if (newer && incoming.content !== existing.content) return "replace";
  if (!newer) return "reject";
  return "coexist";
}

export const MEMORY_TYPES: MemoryType[] = [
  "identity", "preference", "goal", "constraint", "semantic", "episodic", "procedural", "decision", "outcome",
];

/** Supersede: mark old memories as superseded when replaced. */
export function supersededStatus(replacedById: string): { status: "superseded"; replacedById: string } {
  return { status: "superseded", replacedById };
}
