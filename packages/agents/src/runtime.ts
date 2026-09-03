import type { AgentDefinition, AgentRunContext, AgentStepResult, AgentRuntime } from "./index.js";
import { normalizeUsage } from "./usage.js";
import type { ChatRequest, ChatResponse, ModelProfile } from "@imperium/ai";

export interface RuntimeOptions {
  maxSteps: number;
  stepTimeoutMs: number;
  onStep?: (step: AgentStepResult) => void;
}

/**
 * Durable agent runtime: bounded steps, per-step timeout, no runaway loops.
 * Each step goes through the ModelRouter; the first credential that works wins.
 */
export class DefaultAgentRuntime implements AgentRuntime {
  constructor(
    private readonly router: { chat(req: ChatRequest, profile?: ModelProfile): Promise<ChatResponse> },
    private readonly opts: RuntimeOptions,
  ) {}

  async run(req: ChatRequest, ctx: AgentRunContext, profile: ModelProfile = "fast"): Promise<AgentStepResult> {
    const started = Date.now();
    for (let step = 1; step <= this.opts.maxSteps; step++) {
      const res = await this.router.chat(req, profile);
      if (res.finishReason === "stop" || res.finishReason === "tool_calls") {
        const out: AgentStepResult = {
          step,
          content: res.content,
          toolCalls: res.toolCalls.length,
          finishReason: res.finishReason,
          latencyMs: Date.now() - started,
          usage: normalizeUsage(res.usage),
        };
        this.opts.onStep?.(out);
        return out;
      }
    }
    throw new Error(`Агент не завершился за ${this.opts.maxSteps} шагов`);
  }
}
