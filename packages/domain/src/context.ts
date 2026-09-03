export interface ContextCandidate {
  id: string;
  domain: string;
  content: string;
  createdAt: Date;
  importance?: number;
  sensitive?: boolean;
  expiresAt?: Date | null;
}

export interface SelectedContext {
  items: ContextCandidate[];
  why: string[];
  tokenBudget: number;
  tokenBudgetUsed: number;
}

export interface SelectContextOptions {
  tokenBudget: number;
  activeDomains?: string[];
  includeSensitive?: boolean;
  now?: Date;
}

/** Rough token estimate: for mixed RU/EN text ~3.5 chars per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function selectContext(
  query: string,
  candidates: ContextCandidate[],
  options: SelectContextOptions,
): SelectedContext {
  const now = options.now ?? new Date();
  const why: string[] = [];
  const active = options.activeDomains ? new Set(options.activeDomains) : null;

  const pool = candidates.filter((c) => {
    if (c.sensitive && !options.includeSensitive) {
      why.push(`чувствительный домен "${c.domain}" исключён без явного запроса`);
      return false;
    }
    if (c.expiresAt && c.expiresAt.getTime() < now.getTime()) {
      why.push(`истёкший контекст "${c.id}" исключён`);
      return false;
    }
    if (active && !active.has(c.domain)) {
      why.push(`домен "${c.domain}" вне активных доменов`);
      return false;
    }
    return true;
  });

  const scored = pool
    .map((c) => {
      const text = `${query}\n${c.content}`.toLowerCase();
      const qWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const overlap = qWords.filter((w) => text.includes(w)).length;
      const ageHours = (now.getTime() - c.createdAt.getTime()) / 3600_000;
      const recency = Math.max(0, 1 - ageHours / 168);
      const lexical = overlap / Math.max(1, qWords.length);
      return { c, score: lexical * 0.6 + recency * 0.25 + (c.importance ?? 0.5) * 0.15 };
    })
    .sort((a, b) => b.score - a.score);

  const items: ContextCandidate[] = [];
  let used = 0;
  for (const { c, score } of scored) {
    const cost = estimateTokens(c.content);
    if (used + cost > options.tokenBudget) {
      why.push(`бюджет токенов исчерпан: "${c.id}" не включён`);
      continue;
    }
    items.push(c);
    used += cost;
  }

  return { items, why, tokenBudget: options.tokenBudget, tokenBudgetUsed: used };
}
