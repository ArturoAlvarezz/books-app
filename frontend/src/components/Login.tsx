import { FormEvent, useState } from "react";
import { login } from "../api";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await login(String(form.get("username")), String(form.get("password")));
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <h1>📚 Mis Libros</h1>
      <p className="login-subtitle">Tu biblioteca personal</p>
      <form onSubmit={submit}>
        <label>
          Usuario
          <input name="username" defaultValue="admin" autoComplete="username" required />
        </label>
        <label>
          Contraseña
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
    </main>
  );
}
