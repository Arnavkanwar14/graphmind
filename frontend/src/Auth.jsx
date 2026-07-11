import React, { useState } from "react";
import { LogoMark } from "./App.jsx";

const STEPS = [
  ["01", "Connect your documents", "Upload files today; S3 and Google Drive sync are on the way. Everything is encrypted with your own key before it touches storage."],
  ["02", "We build the graph", "An LLM reads every chunk and extracts the people, products, and concepts inside — and how they relate across documents."],
  ["03", "Ask, and trace the answer", "Chat with your knowledge. Every answer cites its sources and shows the path it took through the graph."],
];

export default function Auth({ onLogin }) {
  const resetToken = new URLSearchParams(window.location.search).get("reset");
  const [mode, setMode] = useState(resetToken ? "reset" : "signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body =
        mode === "forgot"
          ? { email }
          : mode === "reset"
            ? { token: resetToken, password }
            : { email, password };
      const r = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) setError(data.detail || "something went wrong");
      else if (mode === "forgot")
        setNotice("If that account exists, a reset link is on its way.");
      else if (mode === "reset") {
        window.history.replaceState(null, "", "/");
        setNotice("Password updated — sign in with it now.");
        setMode("login");
        setPassword("");
      } else onLogin(data);
    } catch {
      setError("can't reach the server — try again in a moment");
    } finally {
      setBusy(false);
    }
  }

  const TITLES = {
    signup: "Create your account",
    login: "Welcome back",
    forgot: "Reset your password",
    reset: "Choose a new password",
  };
  const CTA = { signup: "Start for free", login: "Sign in", forgot: "Send reset link", reset: "Set new password" };

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div className="announce">
        <span className="badge">Private beta</span>
        <span>GraphMind is in early access — free while we build.</span>
        <a className="link-arrow" href="#how">How it works</a>
      </div>

      <div className="hero-bg" style={{ flex: 1 }}>
        <nav className="nav">
          <span className="logo">
            <LogoMark />
            GraphMind
          </span>
          <span className="spacer" />
          <button
            className="link-quiet"
            style={{ textDecoration: "none", fontSize: 14 }}
            onClick={() => setMode("login")}
          >
            Sign in
          </button>
          <button className="btn-ghost-pill" onClick={() => setMode("login")}>
            Live demo
          </button>
          <button className="btn-pill" style={{ padding: "8px 18px", fontSize: 14 }} onClick={() => setMode("signup")}>
            Start for free
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
                {TITLES[mode]}
              </h2>
              <p className="micro" style={{ marginBottom: 24 }}>
                {mode === "signup" && "No card. No sales call."}
                {mode === "login" && "Good to see you again."}
                {mode === "forgot" && "We'll send a link to your email."}
                {mode === "reset" && "Make it a good one."}
              </p>
              {mode !== "reset" && (
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
              )}
              {mode !== "forgot" && (
                <div style={{ marginBottom: 24 }}>
                  <label className="field-label" htmlFor="password">
                    {mode === "reset" ? "New password · 8+ characters" : `Password${mode === "signup" ? " · 8+ characters" : ""}`}
                  </label>
                  <input
                    id="password"
                    className="input"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={mode === "login" ? undefined : 8}
                    required
                  />
                </div>
              )}
              {error && (
                <p className="error" style={{ marginBottom: 16 }}>
                  {error}
                </p>
              )}
              {notice && (
                <p className="micro" style={{ marginBottom: 16, color: "var(--forest)", fontSize: 13 }}>
                  {notice}
                </p>
              )}
              <button className="btn-pill" style={{ width: "100%" }} disabled={busy}>
                {busy ? "…" : CTA[mode]}
              </button>
              <p style={{ marginTop: 20, textAlign: "center", display: "flex", gap: 16, justifyContent: "center" }}>
                <button
                  type="button"
                  className="link-quiet"
                  onClick={() => {
                    setMode(mode === "signup" ? "login" : "signup");
                    setError("");
                    setNotice("");
                  }}
                >
                  {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
                </button>
                {mode === "login" && (
                  <button
                    type="button"
                    className="link-quiet"
                    onClick={() => {
                      setMode("forgot");
                      setError("");
                      setNotice("");
                    }}
                  >
                    Forgot password?
                  </button>
                )}
              </p>
            </form>
          </section>
        </main>
      </div>

      <section className="steps" id="how">
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
