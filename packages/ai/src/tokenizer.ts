/** Rough token estimate: ~3.5 chars per token for mixed RU/EN text. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
