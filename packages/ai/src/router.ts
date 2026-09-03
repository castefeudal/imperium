import type { ChatRequest, ChatResponse, ModelProfile, ProviderAdapter, ProviderCredentials } from "./types.js";
import { ProviderError } from "./types.js";
import { openAiCompatibleAdapter, anthropicAdapter, googleAdapter, testProvider } from "./providers.js";

export interface RouteRule {
  /** Matches against the task kind, e.g. "classification", "planning", "code". */
  match: string;
  profile: ModelProfile;
  /** Preferred credential id; falls back through the list. */
  credentialId?: string;
}

export const DEFAULT_ROUTES: RouteRule[] = [
  { match: "classification", profile: "fast" },
  { match: "planning", profile: "reasoning" },
  { match: "code", profile: "coding" },
  { match: "image", profile: "vision" },
  { match: "embedding", profile: "embedding" },
];

export interface RouterOptions {
  routes?: RouteRule[];
  /** Ordered credential fallback chain. */
  credentials: ProviderCredentials[];
  maxRetries?: number;
}

/**
 * Model router: picks credential + adapter per task profile.
 * Fallback order = credentials array order. Bounded retries, no infinite loops.
 */
export class ModelRouter {
  private readonly adapters: Record<string, ProviderAdapter> = {
    "openai-compatible": openAiCompatibleAdapter(),
    anthropic: anthropicAdapter(),
    google: googleAdapter(),
    test: testProvider(),
  };

  constructor(private readonly opts: RouterOptions) {}

  adapterFor(kind: string): ProviderAdapter {
    const creds = this.opts.credentials[0];
    if (!creds) throw new ProviderError("Нет настроенных учётных данных провайдера", { kind: "openai-compatible", retryable: false });
    const a = this.adapters[creds.kind];
    if (!a) throw new ProviderError(`Нет адаптера для провайдера ${creds.kind}`, { kind: creds.kind, retryable: false });
    return a;
  }

  async chat(req: ChatRequest, profile: ModelProfile = "fast"): Promise<ChatResponse> {
    const errors: unknown[] = [];
    for (const creds of this.opts.credentials) {
      const adapter = this.adapters[creds.kind];
      if (!adapter) continue;
      const attempts = (this.opts.maxRetries ?? 2) + 1;
      for (let i = 0; i < attempts; i++) {
        try {
          return await adapter.chat(creds, req);
        } catch (e) {
          errors.push(e);
          const retryable = e instanceof ProviderError ? e.opts.retryable : true;
          if (!retryable) break;
        }
      }
    }
    throw new ProviderError(
      `Все провайдеры недоступны (${errors.length} ошибок; последняя: ${String(errors.at(-1)).slice(0, 200)})`,
      { kind: "openai-compatible", retryable: true, cause: errors.at(-1) },
    );
  }
}
