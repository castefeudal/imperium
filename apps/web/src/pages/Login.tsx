import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setCsrf } from "../lib/api";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ csrfToken: string }>(`/auth/${mode}`, { email, password });
      setCsrf(res.csrfToken);
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 380, margin: "80px auto", padding: 24, fontFamily: "system-ui", color: "#e6edf3" }}>
      <h1 style={{ fontSize: 26, textAlign: "center" }}>IMPERIUM</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required
          style={{ padding: 10, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3" }} />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" required minLength={8}
          style={{ padding: 10, borderRadius: 8, border: "1px solid #30363d", background: "#161b22", color: "#e6edf3" }} />
        {error && <p style={{ color: "#f85149", margin: 0, fontSize: 14 }}>{error}</p>}
        <button type="submit" disabled={busy}
          style={{ padding: 11, borderRadius: 8, border: "none", background: busy ? "#1f6feb88" : "#1f6feb", color: "#fff", cursor: "pointer" }}>
          {busy ? "…" : mode === "login" ? "Войти" : "Создать аккаунт"}
        </button>
        <button type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}
          style={{ background: "none", border: "none", color: "#58a6ff", cursor: "pointer", fontSize: 14 }}>
          {mode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
        </button>
      </form>
    </main>
  );
}
