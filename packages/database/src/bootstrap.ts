import { pathToFileURL } from "node:url";
import postgres from "postgres";

const ADMIN_URL = process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:@127.0.0.1:5432/postgres";

export async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL не задан");
  const admin = postgres(ADMIN_URL, { onnotice: () => {} });
  const target = new URL(url);
  const dbname = target.pathname.replace(/^\//, "");
  await admin.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await admin.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await admin.unsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  const role = target.username || "imperium";
  await admin.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} LOGIN PASSWORD '${process.env.DATABASE_PASSWORD ?? ""}'; END IF; END $$;`);
  const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbname}`;
  if (exists.length === 0) await admin.unsafe(`CREATE DATABASE ${dbname} OWNER ${role}`);
  await admin.end();
  console.log(`✓ bootstrap: extensions ready, database "${dbname}" ready`);
}

// Run only when executed directly as a script (tsx packages/database/src/bootstrap.ts),
// never on package import — importing must not have side effects.
const invoked = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invoked && import.meta.url === invoked) {
  main().catch((e) => {
    console.error("bootstrap failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
