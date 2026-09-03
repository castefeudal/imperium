import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://imperium:imperium_dev@127.0.0.1:5432/imperium",
      REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
      ENCRYPTION_KEY: process.env.ENCRYPTION_KEY ?? "0".repeat(64),
      LOG_LEVEL: "error",
    },
  },
});
