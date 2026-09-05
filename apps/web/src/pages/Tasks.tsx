import { useState } from "react";
import { NavLink } from "react-router-dom";
import { items, useLoadable } from "../lib/use-loadable";
import { api } from "../lib/api";

interface Task {
  id: string;
  title: string;
  status: string;
  priority: number;
  dueAt: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  inbox: "Входящие", today: "Сегодня", upcoming: "Предстоящие", backlog: "Бэклог",
  in_progress: "В работе", review: "На проверке", done: "Готово", cancelled: "Отменено",
};

export default function TasksPage() {
  const { data: tasks, error: loadError, reload } = useLoadable<Task[]>(
    "/tasks",
    [],
    (res) => items<Task>(res),
  );
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [error, setError] = useState<string | null>(null);


  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.post("/tasks", { title: title.trim(), priority });
      setTitle("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка создания");
    }
  }

  async function complete(t: Task) {
    try {
      await api.patch(`/tasks/${t.id}`, { status: "done" });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка обновления");
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui", color: "#e6edf3", background: "#0d1117", minHeight: "100vh" }}>
      <nav style={{ display: "flex", gap: 16, marginBottom: 24, fontSize: 15 }}>
        <NavLink to="/" style={({ isActive }) => ({ color: isActive ? "#58a6ff" : "#8b949e", textDecoration: "none" })}>Задачи</NavLink>
        <NavLink to="/notes" style={({ isActive }) => ({ color: isActive ? "#58a6ff" : "#8b949e", textDecoration: "none" })}>Заметки</NavLink>
        <NavLink to="/health" style={({ isActive }) => ({ color: isActive ? "#58a6ff" : "#8b949e", textDecoration: "none" })}>Здоровье</NavLink>
      </nav>
      <h1 style={{ fontSize: 28, marginTop: 0 }}>Задачи</h1>
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Новая задача"
          style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3" }} />
        <select value={priority} onChange={(e) => setPriority(e.target.value)}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3" }}>
          <option value="low">Низкий</option>
          <option value="medium">Средний</option>
          <option value="high">Высокий</option>
          <option value="critical">Критичный</option>
        </select>
        <button type="submit" style={{ padding: 10, borderRadius: 8, border: "none", background: "#238636", color: "#fff", cursor: "pointer" }}>Добавить</button>
      </form>
      {(loadError || error) && <p style={{ color: "#f85149" }}>{loadError ?? error}</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {tasks.filter((t) => t.status !== "done").map((t) => (
          <li key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderRadius: 8, background: "#161b22", border: "1px solid #30363d" }}>
            <button onClick={() => complete(t)} title="Отметить выполненной"
              style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #484f58", background: "none", cursor: "pointer", flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{t.title}</span>
            <span style={{ fontSize: 12, color: t.priority >= 4 ? "#f85149" : t.priority >= 3 ? "#d29922" : "#484f58" }}>{t.priority >= 4 ? "!" : t.priority >= 3 ? "··" : "·"}</span>
            <span style={{ fontSize: 12, color: "#8b949e" }}>{STATUS_LABELS[t.status] ?? t.status}</span>
          </li>
        ))}
        {tasks.filter((t) => t.status !== "done").length === 0 && <li style={{ color: "#8b949e" }}>Активных задач нет</li>}
      </ul>
      {tasks.some((t) => t.status === "done") && (
        <>
          <h2 style={{ fontSize: 18, color: "#8b949e", marginTop: 28 }}>Выполнено</h2>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 6 }}>
            {tasks.filter((t) => t.status === "done").map((t) => (
              <li key={t.id} style={{ padding: "8px 16px", borderRadius: 8, color: "#484f58", textDecoration: "line-through", fontSize: 14 }}>{t.title}</li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
