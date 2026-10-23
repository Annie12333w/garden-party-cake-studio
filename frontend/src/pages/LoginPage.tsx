import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth";
import { ErrorNote } from "../components/common";
import { errMsg } from "../util";

export function AuthForm({ onDone, compact = false, initialMode = "login" }: { onDone?: (role: string) => void; compact?: boolean; initialMode?: "login" | "register" }) {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u =
        mode === "login"
          ? await login(email.trim(), password)
          : await register({ name: name.trim(), email: email.trim(), password, phone: phone.trim() || undefined });
      onDone?.(u.role);
    } catch (e2) {
      setError(errMsg(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={`auth-form ${compact ? "compact" : ""}`} onSubmit={submit}>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
          Sign in
        </button>
        <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
          Create account
        </button>
      </div>
      {mode === "register" && (
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
        </label>
      )}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={mode === "register" ? 8 : undefined}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
        />
        {mode === "register" && <span className="tiny muted">At least 8 characters.</span>}
      </label>
      {mode === "register" && (
        <label>
          Phone <span className="muted">(optional)</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />
        </label>
      )}
      <ErrorNote error={error} />
      <button className="btn btn-primary" disabled={busy}>
        {busy ? "One moment…" : mode === "login" ? "Sign in" : "Create account"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");
  const initialMode = params.get("mode") === "register" ? "register" : "login";
  return (
    <section className="auth-layout">
      <div className="auth-visual">
        <img src="/photos/sweetheart.jpg" alt="A ruffled white cake with strawberry hearts, sliced to show the jam layer" style={{ objectPosition: "45% 50%" }} />
      </div>
      <div className="auth-panel">
        <div className="auth-card">
          <p className="eyebrow">Garden Party Cake Studio</p>
          <h1 className="display">Welcome</h1>
          <p className="muted small">
            Sign in to see your orders and pickup times. New here? Choose <strong>Create account</strong> below; it
            takes a minute, and you need one to request a cake.
          </p>
          <AuthForm key={initialMode} initialMode={initialMode} onDone={(role) => nav(next || (role === "staff" ? "/staff" : "/account"))} />
          <details className="demo-logins tiny muted">
            <summary>Demo logins (class project)</summary>
            <p>The demo database comes with sample customer and staff accounts. See the README for their emails and passwords.</p>
          </details>
        </div>
      </div>
    </section>
  );
}
