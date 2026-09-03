import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://imperium:imperium_dev@127.0.0.1:5432/imperium";

async function main() {
  const sql = postgres(DATABASE_URL);
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const applied = new Set((await sql.unsafe<{ name: string }[]>(`SELECT name FROM _migrations`)).map((r) => r.name));
  const dir = join(import.meta.dirname, "../drizzle");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    const body = await readFile(join(dir, f), "utf8");
    const statements = body.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    await sql.begin(async (tx) => {
      for (const s of statements) await tx.unsafe(s);
      await tx.unsafe(`INSERT INTO _migrations (name) VALUES ($1)`, [f]);
    });
    console.log(`applied: ${f}`);
    count++;
  }
  await sql.end();
  console.log(count === 0 ? "migrate: уже актуально" : `migrate: применено ${count}`);
}
main().catch((e) => { console.error("migrate failed:", e.message); process.exit(1); });
