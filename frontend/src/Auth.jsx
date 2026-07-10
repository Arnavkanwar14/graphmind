import React, { useState } from "react";

export default function Auth({ onLogin }) {
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const r = await fetch(`/api/auth/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) onLogin(data);
    else setError(data.detail || "something went wrong");
  }

  return (
    <div className="hero-bg" style={{ minHeight: "100vh" }}>
      <nav className="nav" style={{ background: "transparent", backdropFilter: "none", borderBottom: "1px solid var(--rim)" }}>
        <span className="logo">GraphMind</span>
        <span className="spacer" />
        <span className="badge">Private beta</span>
      </nav>

      <main
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "80px 32px",
          display: "flex",
          flexWrap: "wrap",
          gap: 64,
          alignItems: "center",
        }}
      >
        <section style={{ flex: "1 1 420px", minWidth: 320 }}>
          <p className="eyebrow" style={{ marginBottom: 16 }}>
            AI knowledge graphs for companies
          </p>
          <h1 className="display" style={{ marginBottom: 24 }}>
            See what your
            <br />
            company knows.
          </h1>
          <p className="subtext" style={{ maxWidth: 460 }}>
            Upload your documents. GraphMind builds a living knowledge graph of
            the people, products, and ideas inside them — then answers your
            questions with citations you can trace.
          </p>
        </section>

        <section style={{ flex: "0 1 400px", minWidth: 320 }}>
          <form className="card" onSubmit={submit} style={{ padding: 32 }}>
            <h2
              style={{
                fontWeight: 380,
                fontSize: 24,
                letterSpacing: "-0.24px",
                marginBottom: 24,
              }}
            >
              {mode === "signup" ? "Create your account" : "Welcome back"}
            </h2>
            <div style={{ marginBottom: 16 }}>
              <label className="field-label" htmlFor="email">
                Work email
              </label>
              <input
                id="email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label className="field-label" htmlFor="password">
                Password {mode === "signup" && "(8+ characters)"}
              </label>
              <input
                id="password"
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={mode === "signup" ? 8 : undefined}
                required
              />
            </div>
            {error && (
              <p className="error" style={{ marginBottom: 16 }}>
                {error}
              </p>
            )}
            <button className="btn-pill" style={{ width: "100%" }} disabled={busy}>
              {busy ? "…" : mode === "signup" ? "Start for free" : "Sign in"}
            </button>
            <p style={{ marginTop: 20, textAlign: "center" }}>
              <button
                type="button"
                className="link-quiet"
                onClick={() => {
                  setMode(mode === "signup" ? "login" : "signup");
                  setError("");
                }}
              >
                {mode === "signup"
                  ? "Already have an account? Sign in"
                  : "New here? Create an account"}
              </button>
            </p>
          </form>
        </section>
      </main>
    </div>
  );
}
