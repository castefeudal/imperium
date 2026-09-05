import { useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../lib/api";
import { items, useLoadable } from "../lib/use-loadable";

interface Note {
  id: string;
  title: string;
  body: string | null;
  updatedAt: string;
}

export default function NotesPage() {
  const { data: notes, error, reload } = useLoadable<Note[]>("/notes", [], (res) => items<Note>(res));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api.post("/notes", { title: title.trim(), body: body.trim() || undefined });
      setTitle(""); setBody("");
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Ошибка создания");
    }
  }

  async function remove(id: string) {
    try {
      await api.del(`/notes/${id}`);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Ошибка удаления");
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui", color: "#e6edf3", background: "#0d1117", minHeight: "100vh" }}>
      <nav style={{ display: "flex", gap: 16, marginBottom: 24, fontSize: 15 }}>
        <NavLink to="/" style={({ isActive }) => ({ color: isActive ? "#58a6ff" : "#8b949e", textDecoration: "none" })}>Задачи</NavLink>
        <NavLink to="/notes" style={({ isActive }) => ({ color: isActive ? "#58a6ff" : "#8b949e", textDecoration: "none" })}>Заметки</NavLink>
        <NavLink to="/health" style={({ isActive }) => ({ color: isActive ? "#58a6ff" : "#8b949e", textDecoration: "none" })}>Здоровье</NavLink>
      </nav>
      <h1 style={{ fontSize: 28, marginTop: 0 }}>Заметки</h1>
      <form onSubmit={add} style={{ display: "grid", gap: 8, marginBottom: 20 }}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Заголовок" required
          style={{ padding: 10, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3" }} />
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Текст (необязательно)" rows={3}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3", resize: "vertical" }} />
        <button type="submit" style={{ padding: 10, borderRadius: 8, border: "none", background: "#238636", color: "#fff", cursor: "pointer", justifySelf: "start" }}>Сохранить</button>
      </form>
      {(error || actionError) && <p style={{ color: "#f85149" }}>{error ?? actionError}</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {notes.map((n) => (
          <li key={n.id} style={{ padding: "12px 16px", borderRadius: 8, background: "#161b22", border: "1px solid #30363d" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <strong>{n.title}</strong>
              <button onClick={() => remove(n.id)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 13 }}>удалить</button>
            </div>
            {n.body && <p style={{ margin: "6px 0 0", color: "#8b949e", whiteSpace: "pre-wrap" }}>{n.body}</p>}
            <span style={{ fontSize: 12, color: "#484f58" }}>{new Date(n.updatedAt).toLocaleString("ru-RU")}</span>
          </li>
        ))}
        {notes.length === 0 && <li style={{ color: "#8b949e" }}>Заметок нет</li>}
      </ul>
    </main>
  );
}
