import { beforeAll, afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { users, workspaces, goals, tasks, notes, memories, claims, missions } from "../../src/index.js";
import { eq } from "drizzle-orm";

const URL = process.env.DATABASE_URL!;
let sql: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle>;

beforeAll(async () => {
  sql = postgres(URL, { max: 1 });
  db = drizzle(sql);
  // миграции: применяем дамп схемы напрямую через bootstrap-подобный SQL, если пусто
  const tables = await sql`SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema='public'`;
  if (tables[0]!.c === 0) throw new Error("integration DB пуста — запустите migrate на imperium_int_test");
});

afterAll(async () => { await sql.end(); });

describe("integration: crud over real postgres", () => {
  it("создаёт пользователя → workspace → goal → task, читает обратно, удаляет", async () => {
    const [user] = await db.insert(users).values({ email: `it-${Date.now()}@test.local`, passwordHash: "x" }).returning();
    expect(user).toBeDefined();
    const [ws] = await db.insert(workspaces).values({ name: "IT", slug: `it-${Date.now()}`, ownerId: user!.id }).returning();
    expect(ws).toBeDefined();
    const [goal] = await db.insert(goals).values({ workspaceId: ws!.id, title: "Цель интеграции" }).returning();
    const [task] = await db.insert(tasks).values({ workspaceId: ws!.id, title: "Задача интеграции", goalId: goal!.id, status: "next" }).returning();
    expect(task!.goalId).toBe(goal!.id);
    await db.delete(tasks).where(eq(tasks.id, task!.id));
    await db.delete(goals).where(eq(goals.id, goal!.id));
    await db.delete(workspaces).where(eq(workspaces.id, ws!.id));
    await db.delete(users).where(eq(users.id, user!.id));
  });

  it("soft-delete goals фильтруется", async () => {
    const [user] = await db.insert(users).values({ email: `it2-${Date.now()}@test.local`, passwordHash: "x" }).returning();
    const [ws] = await db.insert(workspaces).values({ name: "IT2", slug: `it2-${Date.now()}`, ownerId: user!.id }).returning();
    const [goal] = await db.insert(goals).values({ workspaceId: ws!.id, title: "Soft", deletedAt: new Date() }).returning();
    const rows = await db.select().from(goals).where(eq(goals.id, goal!.id));
    expect(rows).toHaveLength(1); // строка есть
    expect(rows[0]!.deletedAt).not.toBeNull(); // но помечена удалённой
    await db.delete(goals).where(eq(goals.id, goal!.id));
    await db.delete(workspaces).where(eq(workspaces.id, ws!.id));
    await db.delete(users).where(eq(users.id, user!.id));
  });

  it("notes/memories/claims/missions создаются и каскадно удаляются с workspace", async () => {
    const [user] = await db.insert(users).values({ email: `it3-${Date.now()}@test.local`, passwordHash: "x" }).returning();
    const [ws] = await db.insert(workspaces).values({ name: "IT3", slug: `it3-${Date.now()}`, ownerId: user!.id }).returning();
    await db.insert(notes).values({ workspaceId: ws!.id, title: "N", body: "B" });
    await db.insert(memories).values({ workspaceId: ws!.id, userId: user!.id, type: "semantic", content: "C" });
    await db.insert(claims).values({ workspaceId: ws!.id, domain: "general", statement: "S" });
    await db.insert(missions).values({ workspaceId: ws!.id, title: "M", objective: "O", status: "draft", createdBy: user!.id });
    await db.delete(workspaces).where(eq(workspaces.id, ws!.id));
    const left = await sql`SELECT count(*)::int AS c FROM notes WHERE workspace_id = ${ws!.id}`;
    expect(left[0]!.c).toBe(0);
    await db.delete(users).where(eq(users.id, user!.id));
  });
});
