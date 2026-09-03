import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://imperium:imperium_dev@127.0.0.1:5432/imperium";
const CONFIRM = process.env.CONFIRM_RESET;

async function main() {
  if (CONFIRM !== "yes") {
    console.error("reset: требуется CONFIRM_RESET=yes — операция удаляет ВСЕ данные");
    process.exit(1);
  }
  const url = new URL(DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = postgres(DATABASE_URL.replace(`/${dbName}`, "/postgres"), { max: 1 });
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  const restored = postgres(DATABASE_URL, { max: 1 });
  try {
    await restored.unsafe(`CREATE EXTENSION IF NOT EXISTS vector`);
  } catch {
    console.warn("reset: ВНИМАНИЕ — не удалось создать extension vector (нужен superuser).");
    console.warn("  Выполните: su postgres -c \"psql -d " + dbName + " -c 'CREATE EXTENSION vector';\"");
    console.warn("  Без него migrate упадёт на колонках embedding.");
  }
  await restored.end();
  await admin.end();
  console.log(`reset: база ${dbName} пересоздана. Запустите pnpm migrate && pnpm seed.`);
}

main().catch((e) => { console.error("reset failed:", e.message); process.exit(1); });
