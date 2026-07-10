import React, { useEffect, useState } from "react";
import Auth from "./Auth.jsx";
import Documents from "./Documents.jsx";

const TABS = ["Documents", "Graph", "Chat"];

function Placeholder({ name }) {
  return (
    <div className="card" style={{ maxWidth: 640, margin: "80px auto" }}>
      <p className="eyebrow" style={{ marginBottom: 12 }}>
        {name}
      </p>
      <h2 style={{ fontWeight: 380, fontSize: 24, letterSpacing: "-0.24px", marginBottom: 8 }}>
        Coming next
      </h2>
      <p style={{ color: "var(--fog)" }}>
        {name === "Documents" && "Upload your files here — they'll be encrypted and processed into your knowledge graph."}
        {name === "Graph" && "Your interactive knowledge graph will render here once documents are processed."}
        {name === "Chat" && "Ask questions about your documents and get cited answers here."}
      </p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking
  const [tab, setTab] = useState("Documents");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  if (user === undefined) return null;
  if (!user) return <Auth onLogin={setUser} />;

  return (
    <div style={{ minHeight: "100vh" }}>
      <nav className="nav">
        <span className="logo">GraphMind</span>
        {TABS.map((t) => (
          <button
            key={t}
            className={`nav-link${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
        <span className="spacer" />
        <span className="who">{user.email}</span>
        <button className="btn-ghost-square" onClick={logout}>
          Log out
        </button>
      </nav>
      <main style={{ maxWidth: 1200, margin: "0 auto", padding: "0 32px" }}>
        {tab === "Documents" ? <Documents /> : <Placeholder name={tab} />}
      </main>
    </div>
  );
}
