import type { AuthContext } from "../plugins/auth-helpers.js";

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyInstance {
    db: ReturnType<typeof import("../plugins/db.js").getDb>;
    requireAuth(request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply): Promise<AuthContext | null>;
  }
}

export {};
