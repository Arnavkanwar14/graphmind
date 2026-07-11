import React, { useEffect, useState } from "react";
import Auth from "./Auth.jsx";
import Chat from "./Chat.jsx";
import Dashboard from "./Dashboard.jsx";
import Documents from "./Documents.jsx";
import Graph from "./Graph.jsx";

const TABS = ["Documents", "Graph", "Chat", "Dashboard"];

export function LogoMark() {
  // tiny constellation: three linked nodes, thin stroke, parchment on dark
  return (
    <svg className="logo-mark" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 13.5 L9 4.5 L14 13.5 Z" stroke="var(--copper)" strokeWidth="1" />
      <circle cx="9" cy="4.5" r="2.1" fill="var(--canvas)" stroke="var(--parchment)" strokeWidth="1.1" />
      <circle cx="4" cy="13.5" r="2.1" fill="var(--canvas)" stroke="var(--parchment)" strokeWidth="1.1" />
      <circle cx="14" cy="13.5" r="2.1" fill="var(--canvas)" stroke="var(--parchment)" strokeWidth="1.1" />
    </svg>
  );
}

function Placeholder({ name }) {
  return (
    <div className="card" style={{ maxWidth: 640, margin: "56px auto", textAlign: "center", padding: 48 }}>
      <p className="eyebrow" style={{ marginBottom: 12 }}>
        {name}
      </p>
      <h2 className="heading-sm" style={{ marginBottom: 8 }}>
        Coming next
      </h2>
      <p style={{ color: "var(--fog)" }}>
        {name === "Graph" && "Your interactive knowledge graph will render here once documents are processed."}
        {name === "Chat" && "Ask questions about your documents and get cited answers here."}
      </p>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = checking
  const [tab, setTab] = useState("Documents");
  const [focusEntity, setFocusEntity] = useState(null);

  function showEntity(id) {
    setFocusEntity(id);
    setTab("Graph");
  }

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
        <span className="logo">
          <LogoMark />
          GraphMind
        </span>
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
        <span className="micro">{user.email}</span>
        <button className="btn-ghost-square" onClick={logout}>
          Log out
        </button>
      </nav>
      <main className="page">
        {tab === "Documents" ? (
          <Documents />
        ) : tab === "Graph" ? (
          <Graph focusEntity={focusEntity} onFocused={() => setFocusEntity(null)} />
        ) : tab === "Chat" ? (
          <Chat onShowEntity={showEntity} />
        ) : (
          <Dashboard />
        )}
      </main>
    </div>
  );
}
