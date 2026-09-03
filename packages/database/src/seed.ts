import argon2 from "argon2";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://imperium:imperium_dev@127.0.0.1:5432/imperium";

const DEMO_EMAIL = process.env.SEED_EMAIL ?? "demo@imperium.local";
const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "imperium-demo-2026";

async function main() {
  const sql = postgres(DATABASE_URL);
  try {
    const existing = await sql`SELECT id FROM users WHERE email = ${DEMO_EMAIL} LIMIT 1`;
    if (existing.length > 0) {
      console.log(`seed: пользователь ${DEMO_EMAIL} уже существует, пропускаю`);
      await sql.end();
      return;
    }
    const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
    const [user] = await sql`INSERT INTO users (email, password_hash, timezone) VALUES (${DEMO_EMAIL}, ${passwordHash}, 'Europe/Minsk') RETURNING id`;
    if (!user) throw new Error("seed: user not returned");
    const [ws] = await sql`INSERT INTO workspaces (name, slug, owner_id) VALUES ('Demo', ${"demo-" + crypto.randomUUID().slice(0, 6)}, ${user.id}) RETURNING id`;
    if (!ws) throw new Error("seed: workspace not returned");
    await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws.id}, ${user.id}, 'owner')`;
    await sql`INSERT INTO areas (workspace_id, name) VALUES (${ws.id}, 'Здоровье'), (${ws.id}, 'Работа'), (${ws.id}, 'Знания')`;
    console.log(`seed: создан ${DEMO_EMAIL} / пароль из SEED_PASSWORD (по умолчанию imperium-demo-2026), workspace «Demo»`);
  } finally {
    await sql.end();
  }
}
main().catch((e) => { console.error("seed failed:", e.message); process.exit(1); });
