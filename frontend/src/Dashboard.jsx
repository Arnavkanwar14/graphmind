import React, { useEffect, useState } from "react";
import { TYPE_COLORS } from "./Graph.jsx";

const SINGLE = "#3fa17e"; // one hue for single-series magnitude charts

function HBar({ rows, color, dot }) {
  // rows: [{label, value, type?}]; color: fixed hue or (row) => hue
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div>
      {rows.map((r, i) => (
        <div
          key={i}
          title={`${r.label}: ${r.value}`}
          style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}
        >
          <span
            className="micro"
            style={{ width: 150, flex: "none", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--fog)" }}
          >
            {dot && (
              <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: 9999, background: TYPE_COLORS[r.type] || SINGLE, marginRight: 6 }} />
            )}
            {r.label}
          </span>
          <div style={{ flex: 1, height: 14, position: "relative" }}>
            <div
              style={{
                width: `${(100 * r.value) / max}%`,
                minWidth: 3,
                height: "100%",
                background: typeof color === "function" ? color(r) : color,
                borderRadius: "0 4px 4px 0",
                transition: "opacity 0.2s",
              }}
            />
          </div>
          <span className="micro" style={{ width: 36, flex: "none" }}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Columns({ rows }) {
  // rows: [{day, count}] — column chart, single hue
  const max = Math.max(...rows.map((r) => r.count), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 120, borderBottom: "1px solid var(--rim)", paddingBottom: 0 }}>
      {rows.map((r) => (
        <div key={r.day} title={`${r.day}: ${r.count} document${r.count === 1 ? "" : "s"}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 20 }}>
          <span className="micro">{r.count}</span>
          <div style={{ width: "70%", maxWidth: 34, height: Math.max(4, (96 * r.count) / max), background: SINGLE, borderRadius: "4px 4px 0 0" }} />
          <span className="micro" style={{ fontSize: 10 }}>{r.day.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, children }) {
  return (
    <div className="card" style={{ flex: "1 1 340px", minWidth: 300 }}>
      <p className="eyebrow" style={{ marginBottom: 16 }}>{title}</p>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const [s, setS] = useState(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then(setS);
  }, []);

  if (!s) return null;

  const tiles = [
    [s.documents, "documents"],
    [s.chunks, "chunks indexed"],
    [s.entities, "entities in the graph"],
    [s.relations, "relationships"],
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow" style={{ marginBottom: 10 }}>What your knowledge base knows</p>
          <h1 className="heading-lg">Dashboard</h1>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 28 }}>
        {tiles.map(([v, label]) => (
          <div className="stat" key={label}>
            <p className="stat-value">{v}</p>
            <p className="micro" style={{ marginTop: 6 }}>{label}</p>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", paddingBottom: 80 }}>
        {s.by_day.length > 0 && (
          <Panel title="Documents added · last 14 days">
            <Columns rows={s.by_day} />
          </Panel>
        )}
        {s.top_docs.length > 0 && (
          <Panel title="Chunks per document">
            <HBar rows={s.top_docs.map((d) => ({ label: d.name, value: d.chunks }))} color="#518dd2" />
          </Panel>
        )}
        {s.types.length > 0 && (
          <Panel title="Entities by type">
            <HBar
              rows={s.types.map((t) => ({ label: t.type, value: t.count, type: t.type }))}
              color={(r) => TYPE_COLORS[r.type] || SINGLE}
              dot
            />
          </Panel>
        )}
        {s.top_entities.length > 0 && (
          <Panel title="Most connected entities">
            <HBar
              rows={s.top_entities.map((e) => ({ label: e.name, value: e.degree, type: e.type }))}
              color={SINGLE}
              dot
            />
          </Panel>
        )}
        {s.documents === 0 && (
          <Panel title="Nothing yet">
            <p style={{ color: "var(--fog)" }}>Upload documents and the dashboard fills itself in.</p>
          </Panel>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--rim)", padding: "24px 0 64px" }}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Danger zone</p>
        <button
          className="btn-ghost-square"
          style={{ color: "var(--coral)", borderColor: "#4a1d15" }}
          onClick={async () => {
            if (!window.confirm("Delete your account and ALL its documents, graph data and connectors? This cannot be undone.")) return;
            await fetch("/api/auth/account", { method: "DELETE" });
            window.location.href = "/";
          }}
        >
          Delete account &amp; all data
        </button>
      </div>
    </>
  );
}
