import { useState } from "react";
import { NavLink } from "react-router-dom";
import { items, useLoadable } from "../lib/use-loadable";
import { api } from "../lib/api";

interface SleepEntry {
  id: string;
  quality: number | null;
  durationSec: number | null;
  recordedAt: string;
}

export default function HealthPage() {
  const { data: entries, error: loadError, reload } = useLoadable<SleepEntry[]>(
    "/health/sleep",
    [],
    (res) => items<SleepEntry>(res),
  );
  const [quality, setQuality] = useState("4");
  const [hours, setHours] = useState("7.5");
  const [error, setError] = useState<string | null>(null);


  async function add(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/health/sleep", { durationMin: Math.round(Number(hours) * 60), quality: Number(quality) });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка сохранения");
    }
  }

  const avg = entries.length > 0
    ? entries.reduce((s, e) => s + (e.quality ?? 0), 0) / entries.length
    : null;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 24, fontFamily: "system-ui", color: "#e6edf3", background: "#0d1117", minHeight: "100vh" }}>
      <nav style={{ display: "flex", gap: 16, marginBottom: 24, fontSize: 15 }}>
        <NavLink to="/" style={({ isActive }) => ({ color: isActive ? "#58a6ff" : "#8b949e", textDecoration: "none" })}>Задачи</NavLink>
        <NavLink to="/notes" style={({ isActive }) => ({ color: isActive ? "#58a6ff" : "#8b949e", textDecoration: "none" })}>Заметки</NavLink>
        <NavLink to="/health" style={({ isActive }) => ({ color: isActive ? "#58a6ff" : "#8b949e", textDecoration: "none" })}>Здоровье</NavLink>
      </nav>
      <h1 style={{ fontSize: 28, marginTop: 0 }}>Здоровье — сон</h1>
      <p style={{ color: "#8b949e", fontSize: 13 }}>IMPERIUM не ставит диагнозы. При сомнениях обратитесь к врачу.</p>
      {avg !== null && (
        <p style={{ fontSize: 15 }}>Среднее качество сна: <strong style={{ color: "#3fb950" }}>{avg.toFixed(1)} / 5</strong> за {entries.length} зап.</p>
      )}
      <form onSubmit={add} style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <label style={{ display: "grid", fontSize: 13, color: "#8b949e" }}>Часов сна
          <input type="number" step="0.5" min="0" max="24" value={hours} onChange={(e) => setHours(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3", width: 100 }} />
        </label>
        <label style={{ display: "grid", fontSize: 13, color: "#8b949e" }}>Качество (1–5)
          <input type="number" min="1" max="5" value={quality} onChange={(e) => setQuality(e.target.value)}
            style={{ padding: 10, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3", width: 100 }} />
        </label>
        <button type="submit" style={{ padding: 10, borderRadius: 8, border: "none", background: "#238636", color: "#fff", cursor: "pointer", alignSelf: "end" }}>Записать</button>
      </form>
      {(loadError || error) && <p style={{ color: "#f85149" }}>{loadError ?? error}</p>}
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
        {entries.slice(0, 14).map((e) => (
          <li key={e.id} style={{ padding: "10px 16px", borderRadius: 8, background: "#161b22", border: "1px solid #30363d", display: "flex", justifyContent: "space-between" }}>
            <span>{new Date(e.recordedAt).toLocaleDateString("ru-RU")}</span>
            <span>качество: {e.quality ?? "—"}</span>
          </li>
        ))}
        {entries.length === 0 && <li style={{ color: "#8b949e" }}>Записей нет</li>}
      </ul>
    </main>
  );
}
