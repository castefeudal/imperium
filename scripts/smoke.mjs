#!/usr/bin/env node
/**
 * IMPERIUM smoke test — прогон реального API без тестового раннера.
 * Требует запущенный API (pnpm dev в apps/api или pnpm start).
 *
 * ENV:
 *   SMOKE_URL     — базовый URL API (по умолчанию http://127.0.0.1:3100)
 *   SMOKE_EMAIL   — email для регистрации (по умолчанию smoke-<ts>@imperium.local)
 *   SMOKE_PASSWORD— пароль (по умолчанию imperium-smoke-2026)
 *
 * Выход: код 0 при успехе, 1 при любой ошибке. Каждый шаг печатается.
 */

const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:3100";
const EMAIL = process.env.SMOKE_EMAIL ?? `smoke-${Date.now()}@imperium.local`;
const PASSWORD = process.env.SMOKE_PASSWORD ?? "imperium-smoke-2026";

let cookieJar = "";
let csrfToken = null;
let failures = 0;

function step(name) {
  process.stdout.write(`→ ${name} ... `);
}

function ok(extra = "") {
  console.log(`ok ${extra}`);
}

function fail(msg) {
  failures += 1;
  console.log(`FAIL: ${msg}`);
}

function keepCookies(res) {
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length > 0) {
    const jar = new Map();
    for (const pair of cookieJar.split("; ").filter(Boolean)) {
      const [k, ...v] = pair.split("=");
      jar.set(k, v.join("="));
    }
    for (const c of set) {
      const [pair] = c.split(";");
      const [k, ...v] = pair.split("=");
      jar.set(k.trim(), v.join("="));
    }
    cookieJar = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function call(method, path, body, opts = {}) {
  const headers = { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(opts.headers ?? {}) };
  if (cookieJar) headers.Cookie = cookieJar;
  if (csrfToken && !["GET", "HEAD"].includes(method)) headers["x-csrf-token"] = csrfToken;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  keepCookies(res);
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

function expect(cond, msg) {
  if (cond) ok();
  else fail(msg);
}

async function main() {
  console.log(`IMPERIUM smoke → ${BASE} (учётка ${EMAIL})\n`);

  step("GET /health");
  {
    const r = await call("GET", "/health");
    expect(r.status === 200 && r.json?.status === "ok", `status=${r.status}`);
  }

  step("GET /ready");
  {
    const r = await call("GET", "/ready");
    expect(r.status === 200 && r.json?.ready === true, `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  step("POST /api/v1/auth/register");
  {
    const r = await call("POST", "/api/v1/auth/register", { email: EMAIL, password: PASSWORD, displayName: "Smoke" });
    expect(r.status === 201 || r.status === 409, `status=${r.status} body=${JSON.stringify(r.json)}`);
    if (r.json?.csrfToken) csrfToken = r.json.csrfToken;
  }

  step("POST /api/v1/auth/login");
  {
    const r = await call("POST", "/api/v1/auth/login", { email: EMAIL, password: PASSWORD, displayName: "Smoke" });
    expect(r.status === 200, `status=${r.status} body=${JSON.stringify(r.json)}`);
    if (r.json?.csrfToken) csrfToken = r.json.csrfToken;
    if (!csrfToken) fail("сервер не вернул csrfToken");
  }

  step("GET /api/v1/auth/me");
  {
    const r = await call("GET", "/api/v1/auth/me");
    expect(r.status === 200 && r.json?.user?.email === EMAIL, `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  step("GET /api/v1/workspaces");
  {
    const r = await call("GET", "/api/v1/workspaces");
    expect(r.status === 200 && Array.isArray(r.json?.workspaces) && r.json.workspaces.length > 0, `status=${r.status}`);
  }

  const workspaceId = (await call("GET", "/api/v1/workspaces")).json?.workspaces?.[0]?.id;
  if (!workspaceId) { fail("нет workspace — дальше CRUD не проверить"); process.exit(1); }

  step("POST /api/v1/tasks (создать)");
  let taskId = null;
  {
    const r = await call("POST", "/api/v1/tasks", { title: `smoke-task-${Date.now()}`, workspaceId });
    expect(r.status === 201, `status=${r.status} body=${JSON.stringify(r.json)}`);
    taskId = r.json?.id ?? null;
  }

  step(`GET /api/v1/tasks/${taskId}`);
  {
    const r = await call("GET", `/api/v1/tasks/${taskId}`);
    expect(r.status === 200 && r.json?.id === taskId, `status=${r.status}`);
  }

  step(`PATCH /api/v1/tasks/${taskId} (в work)`);
  {
    const r = await call("PATCH", `/api/v1/tasks/${taskId}`, { status: "in_progress" });
    expect(r.status === 200 && r.json?.status === "in_progress", `status=${r.status} body=${JSON.stringify(r.json)}`);
  }

  step("GET /api/v1/notes + POST");
  {
    const created = await call("POST", "/api/v1/notes", { title: "smoke-note", body: "привет из smoke" });
    expect(created.status === 201, `status=${created.status} body=${JSON.stringify(created.json)}`);
    const list = await call("GET", "/api/v1/notes");
    expect(list.status === 200, `status=${list.status}`);
  }

  step("POST /api/v1/goals + GET");
  {
    const created = await call("POST", "/api/v1/goals", { title: "smoke-goal", workspaceId });
    expect(created.status === 201, `status=${created.status} body=${JSON.stringify(created.json)}`);
    const list = await call("GET", "/api/v1/goals");
    expect(list.status === 200 && Array.isArray(list.json?.goals ?? list.json), `status=${list.status}`);
  }

  step("DELETE /api/v1/tasks/:id (cleanup)");
  {
    const r = await call("DELETE", `/api/v1/tasks/${taskId}`);
    expect(r.status === 200 || r.status === 204, `status=${r.status}`);
  }

  step("GET /api/v1/health/overview (модуль здоровья)");
  {
    const r = await call("GET", "/api/v1/health/overview");
    expect(r.status === 200 && typeof r.json?.disclaimer === "string", `status=${r.status}`);
  }

  step("POST /api/v1/auth/logout");
  {
    const r = await call("POST", "/api/v1/auth/logout");
    expect(r.status === 200 || r.status === 204, `status=${r.status}`);
  }

  step("GET /api/v1/auth/me после logout → 401");
  {
    const r = await call("GET", "/api/v1/auth/me");
    expect(r.status === 401, `status=${r.status} (ожидался 401)`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`ИТОГ: ${failures} неудач(и). Smoke провален.`);
    process.exit(1);
  }
  console.log("ИТОГ: все шаги прошли. Smoke зелёный ✅");
}

main().catch((e) => {
  console.error(`smoke crashed: ${e.message}`);
  process.exit(1);
});
