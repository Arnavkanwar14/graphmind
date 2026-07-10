import React, { useEffect, useState } from "react";

const wrap = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  background: "#0d1117",
  color: "#e6edf3",
  fontFamily: "system-ui, sans-serif",
};

export default function App() {
  const [health, setHealth] = useState(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ db: "unreachable" }));
  }, []);

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: "3rem", margin: 0 }}>GraphMind</h1>
      <p style={{ color: "#8b949e" }}>
        AI knowledge graphs for your company&apos;s documents.
      </p>
      <code style={{ color: health?.db === "ok" ? "#3fb950" : "#d29922" }}>
        api: {health ? JSON.stringify(health) : "checking..."}
      </code>
    </div>
  );
}
