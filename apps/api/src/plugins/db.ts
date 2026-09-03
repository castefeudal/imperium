import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@imperium/database";

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const client = postgres(url, { max: 10, idle_timeout: 20, connect_timeout: 10 });
  return drizzle(client, { schema });
}

export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  return createDb(url);
}
