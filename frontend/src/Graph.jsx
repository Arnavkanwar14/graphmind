import React, { useCallback, useEffect, useRef, useState } from "react";
import ForceGraph2D from "react-force-graph-2d";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceX,
  forceY,
} from "d3-force-3d";

// categorical palette validated against the dark surface (dataviz six checks)
export const TYPE_COLORS = {
  person: "#d95b41",
  org: "#518dd2",
  product: "#3fa17e",
  concept: "#8f7fc7",
  place: "#b07f36",
  document: "#185849",
};

// Lay the graph out ONCE, synchronously, before it's ever rendered — instead of
// letting react-force-graph animate it. Its runtime simulation left the nodes
// frozen in a rigid phyllotaxis circle (it rebuilds its own forces on mount, and
// the only override hook depends on an animation loop that browsers throttle when
// the tab isn't focused). Precomputing positions here is deterministic: strong
// range-capped repulsion spreads clusters apart, links pull related nodes
// together, and mild x/y gravity keeps it centered — the organic Obsidian look,
// identical in every browser. Mutates graph.nodes in place (adds x/y).
function computeLayout(graph) {
  // run on copies of the links so the originals keep their string source/target
  // ids for react-force-graph (d3's forceLink rewrites them to node objects).
  // Drop links whose endpoints aren't in the node set — the graph can contain a
  // mention edge to a failed document that isn't rendered as a node; react-force-
  // graph tolerates that dangling link but d3's forceLink throws on it.
  const ids = new Set(graph.nodes.map((n) => n.id));
  const links = graph.links
    .filter((l) => ids.has(l.source) && ids.has(l.target))
    .map((l) => ({ source: l.source, target: l.target, kind: l.kind }));
  const sim = forceSimulation(graph.nodes, 2)
    .force("charge", forceManyBody().strength(-170).distanceMax(420))
    .force(
      "link",
      forceLink(links)
        .id((n) => n.id)
        .distance((l) => (l.kind === "mention" ? 30 : 58))
        .strength(0.22),
    )
    .force("collide", forceCollide(7))
    .force("x", forceX().strength(0.045))
    .force("y", forceY().strength(0.045))
    .stop();
  for (let i = 0; i < 320; i++) sim.tick();
}

export default function Graph({ focusEntity, onFocused }) {
  const [data, setData] = useState(null);
  const [detail, setDetail] = useState(null); // {name, type, relations, sources, documents}
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [hoverType, setHoverType] = useState(null); // legend hover -> dims other types
  const [ready, setReady] = useState(false); // fades the canvas in once positioned
  const wrapRef = useRef();
  const fgRef = useRef();
  const highlightRef = useRef(null);
  const hoverTypeRef = useRef(null);
  hoverTypeRef.current = hoverType;

  useEffect(() => {
    fetch("/api/graph")
      .then((r) => (r.ok ? r.json() : { nodes: [], links: [] }))
      .then((d) => {
        // position the nodes up front so the graph renders already settled
        try {
          if (d.nodes.length) computeLayout(d);
        } catch (e) {
          console.error("computeLayout failed:", e);
        }
        setData(d);
        setTimeout(() => setReady(true), 60);
      });
  }, []);

  // arriving from chat: center on the entity, ring it, open its panel
  useEffect(() => {
    if (!focusEntity || !data) return;
    const nid = `e${focusEntity}`;
    highlightRef.current = nid;
    fetch(`/api/graph/entity/${focusEntity}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDetail(d));
    const t = setTimeout(() => {
      const node = data.nodes.find((n) => n.id === nid);
      if (node && fgRef.current && node.x != null) {
        fgRef.current.centerAt(node.x, node.y, 700);
        fgRef.current.zoom(3.5, 700);
      }
      onFocused?.();
    }, 800);
    return () => clearTimeout(t);
  }, [focusEntity, data]);

  useEffect(() => {
    function measure() {
      // clientWidth is 0 while the tab is hidden (display:none) — ignore those
      // so a background resize doesn't collapse the canvas to zero width
      if (wrapRef.current && wrapRef.current.clientWidth > 0) {
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
    const dim = hoverTypeRef.current && node.type !== hoverTypeRef.current;
    const r = 2.5 + Math.sqrt(node.degree || 1) * 1.6;
    ctx.globalAlpha = dim ? 0.15 : 1;
    ctx.beginPath();
    ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
    ctx.fillStyle = TYPE_COLORS[node.type] || TYPE_COLORS.concept;
    ctx.fill();
    if (node.type === "document") {
      ctx.strokeStyle = "#e9ebdf";
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    if (node.id === highlightRef.current) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
      ctx.strokeStyle = "#e9ebdf";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    if (!dim && (scale > 1.4 || (node.degree || 0) > 6)) {
      ctx.font = `${Math.max(9 / scale, 2.4)}px "Space Grotesk", sans-serif`;
      ctx.fillStyle = "rgba(233, 235, 223, 0.85)";
      ctx.textAlign = "center";
      ctx.fillText(node.name.slice(0, 28), node.x, node.y + r + 5 / scale);
    }
    ctx.globalAlpha = 1;
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
      <div className="page-head rise" style={{ paddingBottom: 20 }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 10 }}>
            {data ? `${data.nodes.length} nodes · ${data.links.length} edges` : "loading"}
          </p>
          <h1 className="heading-lg">Knowledge graph</h1>
        </div>
        <span className="spacer" />
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          {Object.entries(TYPE_COLORS).map(([t, c]) => (
            <button
              key={t}
              className="legend-item micro"
              style={{ display: "flex", alignItems: "center", gap: 5, opacity: hoverType && hoverType !== t ? 0.4 : 1 }}
              onMouseEnter={() => setHoverType(t)}
              onMouseLeave={() => setHoverType(null)}
            >
              <span style={{ width: 8, height: 8, borderRadius: 9999, background: c, display: "inline-block" }} />
              {t}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", paddingBottom: 48 }}>
        <div
          ref={wrapRef}
          className="deep"
          style={{
            flex: 1,
            minWidth: 0,
            border: "1px solid var(--rim)",
            overflow: "hidden",
            opacity: ready ? 1 : 0,
            transition: "opacity 0.5s var(--ease)",
          }}
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
              linkColor={(l) => {
                const base = l.kind === "mention" ? [24, 88, 73] : [139, 134, 127];
                const ht = hoverTypeRef.current;
                if (!ht) return `rgba(${base.join(",")}, 0.35)`;
                const touches = l.source?.type === ht || l.target?.type === ht;
                return `rgba(${base.join(",")}, ${touches ? 0.55 : 0.05})`;
              }}
              linkWidth={(l) => (l.kind === "mention" ? 0.5 : 1)}
              linkLabel={(l) => l.label}
              onNodeClick={onNodeClick}
              warmupTicks={0}
              cooldownTicks={0}
            />
          )}
        </div>

        {detail && (
          <aside
            key={detail.name}
            className="card panel-slide"
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
