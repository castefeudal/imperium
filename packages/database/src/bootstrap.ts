import postgres from "postgres";

const ADMIN_URL = process.env.DATABASE_URL_ADMIN ?? "postgresql://postgres:@127.0.0.1:5432/postgres";

export async function main() {
  const admin = postgres(ADMIN_URL, { onnotice: () => {} });
  const target = new URL(process.env.DATABASE_URL ?? "");
  const dbname = target.pathname.replace(/^\//, "");
  await admin.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  await admin.unsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  await admin.unsafe(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
  const role = (target.username || "imperium");
  await admin.unsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${role}') THEN CREATE ROLE ${role} LOGIN PASSWORD '${process.env.DATABASE_PASSWORD ?? ""}'; END IF; END $$;`);
  const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${dbname}`;
  if (exists.length === 0) await admin.unsafe(`CREATE DATABASE ${dbname} OWNER ${role}`);
  await admin.end();
  console.log(`✓ bootstrap: extensions ready, database "${dbname}" ready`);
}

if (import.meta.url === `file://${process.argv[1]}`) { await main(); } else { main().catch((e) => { console.error("bootstrap failed:", e.message); process.exit(1); }); }
