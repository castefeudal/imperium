/** REST-клиент IMPERIUM для MCP-слоя. Один bearer-ключ = один workspace. */
export interface ImperiumClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class ImperiumApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export class ImperiumClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ImperiumClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.opts.apiKey}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const msg = (data as { error?: unknown } | null)?.error;
      throw new ImperiumApiError(res.status, typeof msg === "string" ? msg : `API ${res.status}`);
    }
    return data as T;
  }

  private async list<T>(path: string): Promise<T[]> {
    const data = await this.request<{ items?: T[] } | T[]>("GET", path);
    if (Array.isArray(data)) return data;
    return data.items ?? [];
  }

  getToday() {
    return this.request<Record<string, unknown>>("GET", "/api/v1/today");
  }

  search(query: string, limit?: number) {
    const q = new URLSearchParams({ q: query, ...(limit ? { limit: String(limit) } : {}) });
    return this.request<{ results: unknown[] }>("GET", `/api/v1/search?${q}`);
  }

  createTask(args: { title: string; priority?: number; due?: string; projectId?: string; description?: string; idempotencyKey?: string }) {
    const { idempotencyKey, ...body } = args;
    return this.request<Record<string, unknown>>("POST", "/api/v1/tasks", body, idempotencyKey);
  }

  updateTask(id: string, patch: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("PATCH", `/api/v1/tasks/${id}`, patch);
  }

  async completeTask(id: string) {
    return this.updateTask(id, { status: "done" });
  }

  createNote(args: { title: string; body: string; idempotencyKey?: string }) {
    const { idempotencyKey, ...body } = args;
    return this.request<Record<string, unknown>>("POST", "/api/v1/notes", body, idempotencyKey);
  }

  async getGoals() {
    return this.list<unknown>("/api/v1/goals");
  }

  getProject(id: string) {
    return this.request<Record<string, unknown>>("GET", `/api/v1/projects/${id}`);
  }

  createMission(args: { title: string; goal: string; allowedTools?: string[]; idempotencyKey?: string }) {
    const { idempotencyKey, ...body } = args;
    return this.request<Record<string, unknown>>("POST", "/api/v1/missions", { ...body, prompt: args.goal }, idempotencyKey);
  }

  runMission(id: string) {
    return this.request<Record<string, unknown>>("POST", `/api/v1/missions/${id}/run`, {});
  }

  getMission(id: string) {
    return this.request<Record<string, unknown>>("GET", `/api/v1/missions/${id}`);
  }

  captureInbox(args: { content: string; source?: string; idempotencyKey?: string }) {
    const { idempotencyKey, ...body } = args;
    return this.request<Record<string, unknown>>("POST", "/api/v1/inbox", { title: body.content.slice(0, 500), body: body.content, channel: "agent", category: "fyi" }, idempotencyKey);
  }

  async getHealthSummary() {
    return this.request<Record<string, unknown>>("GET", "/api/v1/health/overview");
  }

  async getContext() {
    const [tasks, goals, missions, notes] = await Promise.all([
      this.list<unknown>("/api/v1/tasks?limit=20"),
      this.list<unknown>("/api/v1/goals"),
      this.list<unknown>("/api/v1/missions?limit=10"),
      this.list<unknown>("/api/v1/notes?limit=10"),
    ]);
    return { tasks, goals, missions, recentNotes: notes };
  }
}
