import React, { useState } from "react";
import { LogoMark } from "./App.jsx";

const STEPS = [
  ["01", "Connect your documents", "Upload files today; S3 and Google Drive sync are on the way. Everything is encrypted with your own key before it touches storage."],
  ["02", "We build the graph", "An LLM reads every chunk and extracts the people, products, and concepts inside — and how they relate across documents."],
  ["03", "Ask, and trace the answer", "Chat with your knowledge. Every answer cites its sources and shows the path it took through the graph."],
];

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
    try {
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) onLogin(data);
      else setError(data.detail || "something went wrong");
    } catch {
      setError("can't reach the server — try again in a moment");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div className="announce">
        <span className="badge">Private beta</span>
        <span>GraphMind is in early access — free while we build.</span>
      </div>

      <div className="hero-bg" style={{ flex: 1 }}>
        <nav
          className="nav"
          style={{ background: "transparent", backdropFilter: "none" }}
        >
          <span className="logo">
            <LogoMark />
            GraphMind
          </span>
          <span className="spacer" />
          <button
            className="btn-ghost-pill"
            onClick={() => setMode(mode === "signup" ? "login" : "signup")}
          >
            {mode === "signup" ? "Sign in" : "Create account"}
          </button>
        </nav>

        <main
          className="page"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 64,
            alignItems: "center",
            padding: "72px 32px 96px",
          }}
        >
          <section style={{ flex: "1 1 460px", minWidth: 320 }}>
            <p className="eyebrow rise" style={{ marginBottom: 20 }}>
              AI knowledge graphs for companies
            </p>
            <h1 className="display rise" style={{ marginBottom: 28, animationDelay: "0.08s" }}>
              See what your
              <br />
              company <span className="shimmer">knows.</span>
            </h1>
            <p className="subtext rise" style={{ maxWidth: 480, animationDelay: "0.16s" }}>
              GraphMind turns your documents into a living knowledge graph —
              then answers questions with citations you can trace, node by node.
            </p>
            <p className="micro rise" style={{ marginTop: 28, animationDelay: "0.24s" }}>
              Encrypted at rest · your data never trains anyone's model
            </p>
          </section>

          <section className="rise" style={{ flex: "0 1 400px", minWidth: 320, animationDelay: "0.2s" }}>
            <form className="card" onSubmit={submit} style={{ padding: 32 }}>
              <h2 className="heading-sm" style={{ marginBottom: 4 }}>
                {mode === "signup" ? "Create your account" : "Welcome back"}
              </h2>
              <p className="micro" style={{ marginBottom: 24 }}>
                {mode === "signup" ? "No card. No sales call." : "Good to see you again."}
              </p>
              <div style={{ marginBottom: 16 }}>
                <label className="field-label" htmlFor="email">
                  Work email
                </label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label className="field-label" htmlFor="password">
                  Password{mode === "signup" ? " · 8+ characters" : ""}
                </label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  placeholder="••••••••"
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

      <section className="steps">
        <div className="page" style={{ display: "flex", flexWrap: "wrap", padding: 0 }}>
          {STEPS.map(([no, title, body]) => (
            <div className="step" key={no}>
              <p className="step-no">{no}</p>
              <h3 style={{ fontWeight: 380, fontSize: 18, letterSpacing: "-0.01em", marginBottom: 8 }}>
                {title}
              </h3>
              <p style={{ fontSize: 14, color: "var(--ash)", lineHeight: 1.5 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
