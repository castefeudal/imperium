import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 60_000,
    pool: "forks",
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://imperium:imperium_dev@127.0.0.1:5432/imperium_int_test",
    },
  },
});
