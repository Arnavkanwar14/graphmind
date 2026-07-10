import React, { useCallback, useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";

const TYPE_COLORS = {
  person: "#e8765e",
  org: "#518dd2",
  product: "#3fa17e",
  concept: "#b6b8af",
  place: "#c99a5b",
  document: "#185849",
};

export default function Graph() {
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null); // {name, type, relations, sources, documents}
  const [size, setSize] = useState({ w: 800, h: 560 });
  const wrapRef = useRef();
  const fgRef = useRef();

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => (r.ok ? r.json() : { nodes: [], links: [] }))
      .then(setData);
  }, []);

  useEffect(() => {
    function measure() {
      if (wrapRef.current) {
        setSize({
          w: wrapRef.current.clientWidth,
          h: Math.max(420, window.innerHeight - 230),
        });
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [data]);

  const drawNode = useCallback((node, ctx, scale) => {
    const r = 2.5 + Math.sqrt(node.degree || 1) * 1.6;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = TYPE_COLORS[node.type] || TYPE_COLORS.concept;
    ctx.fill();
    if (node.type === "document") {
      ctx.strokeStyle = "#e9ebdf";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    if (scale > 1.4 || (node.degree || 0) > 6) {
      ctx.font = `${Math.max(9 / scale, 2.4)}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = "rgba(233, 235, 223, 0.85)";
      ctx.textAlign = "center";
      ctx.fillText(node.name.slice(0, 28), node.x, node.y + r + 5 / scale);
    }
  }, []);

  async function onNodeClick(node) {
    if (!node.id.startsWith("e")) return;
    const r = await fetch(`/api/graph/entity/${node.id.slice(1)}`);
    if (r.ok) setDetail(await r.json());
  }

  if (data && data.nodes.length === 0) {
    return (
      <div className="card" style={{ maxWidth: 640, margin: "56px auto", textAlign: "center", padding: 48 }}>
        <p className="eyebrow" style={{ marginBottom: 12 }}>Graph</p>
        <h2 className="heading-sm" style={{ marginBottom: 8 }}>Nothing to map yet</h2>
        <p style={{ color: "var(--fog)" }}>
          Upload documents and the graph builds itself as they're processed.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="page-head" style={{ paddingBottom: 20 }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 10 }}>
            {data ? `${data.nodes.length} nodes · ${data.links.length} edges` : "loading"}
          </p>
          <h1 className="heading-lg">Knowledge graph</h1>
        </div>
        <span className="spacer" />
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {Object.entries(TYPE_COLORS).map(([t, c]) => (
            <span key={t} className="micro" style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: c, display: "inline-block" }} />
              {t}
            </span>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", paddingBottom: 48 }}>
        <div
          ref={wrapRef}
          className="deep"
          style={{ flex: 1, minWidth: 0, border: "1px solid var(--rim)", overflow: "hidden" }}
        >
          {data && (
            <ForceGraph2D
              ref={fgRef}
              graphData={data}
              width={size.w}
              height={size.h}
              backgroundColor="#0e0e0e"
              nodeCanvasObject={drawNode}
              nodePointerAreaPaint={(node, color, ctx) => {
                const r = 2.5 + Math.sqrt(node.degree || 1) * 1.6 + 3;
                ctx.beginPath();
                ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
                ctx.fillStyle = color;
                ctx.fill();
              }}
              linkColor={(l) => (l.kind === "mention" ? "rgba(24, 88, 73, 0.35)" : "rgba(139, 134, 127, 0.35)")}
              linkWidth={(l) => (l.kind === "mention" ? 0.5 : 1)}
              linkLabel={(l) => l.label}
              onNodeClick={onNodeClick}
              cooldownTicks={120}
            />
          )}
        </div>

        {detail && (
          <aside
            className="card"
            style={{ flex: "0 0 340px", maxHeight: "70vh", overflowY: "auto", position: "sticky", top: 84 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
              <h2 className="heading-sm" style={{ flex: 1 }}>{detail.name}</h2>
              <button className="link-quiet" onClick={() => setDetail(null)}>close</button>
            </div>
            <p className="micro" style={{ marginBottom: 20, color: TYPE_COLORS[detail.type] }}>
              {detail.type}
            </p>

            {detail.relations.length > 0 && (
              <>
                <p className="eyebrow" style={{ marginBottom: 10 }}>Relationships</p>
                <div style={{ marginBottom: 20 }}>
                  {detail.relations.map((r, i) => (
                    <p key={i} style={{ fontSize: 14, color: "var(--fog)", marginBottom: 6 }}>
                      {r.outbound ? (
                        <>
                          <span style={{ color: "var(--copper)" }}>{r.label}</span> → {r.other}
                        </>
                      ) : (
                        <>
                          {r.other} <span style={{ color: "var(--copper)" }}>{r.label}</span> →
                        </>
                      )}
                    </p>
                  ))}
                </div>
              </>
            )}

            {detail.sources.length > 0 && (
              <>
                <p className="eyebrow" style={{ marginBottom: 10 }}>Sources</p>
                {detail.sources.map((s, i) => (
                  <div key={i} style={{ marginBottom: 14 }}>
                    <p className="micro" style={{ color: "var(--copper)", marginBottom: 3 }}>
                      {s.document}
                      {s.page_no != null && ` · p. ${s.page_no}`}
                    </p>
                    <p style={{ fontSize: 13, color: "var(--ash)" }}>{s.excerpt}…</p>
                  </div>
                ))}
              </>
            )}

            {detail.documents.length > 0 && (
              <>
                <p className="eyebrow" style={{ margin: "6px 0 10px" }}>Mentioned in</p>
                {detail.documents.map((d) => (
                  <p key={d} className="micro" style={{ marginBottom: 4 }}>{d}</p>
                ))}
              </>
            )}
          </aside>
        )}
      </div>
    </>
  );
}
