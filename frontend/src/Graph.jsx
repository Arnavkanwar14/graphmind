import React, { useEffect, useRef, useState } from "react";
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

// node radius, capped so a huge-degree hub (e.g. degree 400+) doesn't render as
// a giant blob that swallows its neighbors
export const nodeRadius = (n) => 1.8 + Math.min(Math.sqrt(n.degree || 1), 5.5);

const CHARGE_STRENGTH = -75;
const CHARGE_MAX = 220;
const linkDistance = (l) => (l.kind === "mention" ? 60 : 32);
const linkStrength = (l) => (l.kind === "mention" ? 0.04 : 0.45);
const GRAVITY = 0.035;

function buildSimulation(nodes, links) {
  return forceSimulation(nodes, 2)
    .force("charge", forceManyBody().strength(CHARGE_STRENGTH).distanceMax(CHARGE_MAX))
    .force("link", forceLink(links).id((n) => n.id).distance(linkDistance).strength(linkStrength))
    // extra padding beyond the node's own radius so hubs don't visually overlap
    // their neighbors even when several sit at similar distances
    .force("collide", forceCollide((n) => nodeRadius(n) + 5))
    .force("x", forceX().strength(GRAVITY))
    .force("y", forceY().strength(GRAVITY));
}

/**
 * A hand-rolled canvas force graph, not react-force-graph. That library's
 * render loop kept dying permanently on an internal exception during
 * click/drag — once its loop crashes, nothing schedules another frame, so the
 * canvas stays however it looked at that instant: blank, forever. Standard
 * force-directed graph tooling (the same idiom behind D3's own official
 * examples, and conceptually what Obsidian's graph view is built on) is just:
 * a physics simulation + a plain canvas draw loop + your own mouse handlers.
 * Owning every frame means a single bad frame can never take down the rest —
 * the draw loop below is wrapped so it always reschedules itself no matter what.
 */
export default function Graph({ focusEntity, onFocused }) {
  const [meta, setMeta] = useState(null); // {nodeCount, linkCount} just for the header text
  const [empty, setEmpty] = useState(false);
  const [detail, setDetail] = useState(null); // {name, type, relations, sources, documents}
  const [hoverType, setHoverType] = useState(null); // legend hover -> dims other types
  const [ready, setReady] = useState(false); // fades the canvas in once positioned

  const wrapRef = useRef();
  const canvasRef = useRef();
  const simRef = useRef(null);
  const nodesRef = useRef([]);
  const linksRef = useRef([]);
  const sizeRef = useRef({ w: 800, h: 560 });
  const transformRef = useRef({ x: 0, y: 0, k: 1 }); // screen = graph*k + {x,y}; centered once layout+size are known
  const selectedRef = useRef(null); // {id, neighbors:Set}
  const highlightRef = useRef(null); // focused-from-chat entity id, rings it
  const hoverTypeRef = useRef(null);
  const dragRef = useRef(null);
  hoverTypeRef.current = hoverType;

  // fetch the graph once, precompute a settled layout, then start live physics
  useEffect(() => {
    let cancelled = false;
    fetch("/api/graph")
      .then((r) => (r.ok ? r.json() : { nodes: [], links: [] }))
      .then((d) => {
        if (cancelled) return;
        if (!d.nodes.length) {
          setEmpty(true);
          return;
        }
        // drop links whose endpoints aren't in the node set — a mention edge
        // to a failed document that isn't rendered as a node — d3's forceLink
        // throws on a dangling reference
        const ids = new Set(d.nodes.map((n) => n.id));
        const links = d.links
          .filter((l) => ids.has(l.source) && ids.has(l.target))
          .map((l) => ({ source: l.source, target: l.target, kind: l.kind, label: l.label }));
        nodesRef.current = d.nodes;
        linksRef.current = links;

        // settle the layout synchronously so it never appears as a random
        // scatter, then keep the SAME simulation running live (standard d3
        // drag idiom: wake it with alphaTarget on drag, cool it back down after)
        const sim = buildSimulation(d.nodes, links).stop();
        for (let i = 0; i < 300; i++) sim.tick();
        sim.restart();
        simRef.current = sim;

        // fit the settled layout's bounding box into the canvas instead of
        // guessing a starting transform
        const xs = d.nodes.map((n) => n.x).filter(Number.isFinite);
        const ys = d.nodes.map((n) => n.y).filter(Number.isFinite);
        if (xs.length) {
          const minX = Math.min(...xs), maxX = Math.max(...xs);
          const minY = Math.min(...ys), maxY = Math.max(...ys);
          const { w, h } = sizeRef.current;
          const k = Math.min((w * 0.9) / (maxX - minX || 1), (h * 0.9) / (maxY - minY || 1), 3);
          const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
          transformRef.current = { k, x: w / 2 - cx * k, y: h / 2 - cy * k };
        }

        setMeta({ nodeCount: d.nodes.length, linkCount: links.length });
        setTimeout(() => setReady(true), 60);
      });
    return () => {
      cancelled = true;
      simRef.current?.stop();
    };
  }, []);

  // arriving from chat: center on the entity, ring it, open its panel
  useEffect(() => {
    if (!focusEntity || !meta) return;
    const nid = `e${focusEntity}`;
    highlightRef.current = nid;
    fetch(`/api/graph/entity/${focusEntity}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDetail(d));
    selectedRef.current = null; // let the ring (highlightRef), not a neighborhood dim, carry the emphasis
    const t = setTimeout(() => {
      const node = nodesRef.current.find((n) => n.id === nid);
      if (node && Number.isFinite(node.x)) {
        const { w, h } = sizeRef.current;
        const k = 2.5;
        transformRef.current = { k, x: w / 2 - node.x * k, y: h / 2 - node.y * k };
      }
      onFocused?.();
    }, 350);
    return () => clearTimeout(t);
  }, [focusEntity, meta]);

  // size the canvas to its container; ignore while hidden (display:none tab)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function apply() {
      if (el.clientWidth > 0) {
        sizeRef.current = { w: el.clientWidth, h: Math.max(420, window.innerHeight - 230) };
        const cv = canvasRef.current;
        if (cv) {
          cv.width = sizeRef.current.w;
          cv.height = sizeRef.current.h;
        }
      }
    }
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, []);

  // the draw loop: runs forever via its own requestAnimationFrame chain,
  // decoupled from the physics simulation entirely, so panning/zooming/hover
  // keeps redrawing even once physics has settled. A try/catch means a single
  // bad frame can never stop the next one from being scheduled.
  useEffect(() => {
    if (!meta) return;
    let raf;
    function frame() {
      try {
        drawFrame();
      } catch {
        /* never let one bad frame kill every frame after it */
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [meta]);

  function drawFrame() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const { width: w, height: h } = canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#0e0e0e";
    ctx.fillRect(0, 0, w, h);

    const t = transformRef.current;
    ctx.setTransform(t.k, 0, 0, t.k, t.x, t.y);

    const sel = selectedRef.current;
    const ht = hoverTypeRef.current;
    const scale = t.k;

    // links
    for (const l of linksRef.current) {
      const s = l.source, d = l.target;
      if (typeof s !== "object" || typeof d !== "object") continue;
      if (!Number.isFinite(s.x) || !Number.isFinite(d.x)) continue;
      const base = l.kind === "mention" ? "24,88,73" : "139,134,127";
      let alpha = l.kind === "mention" ? 0.3 : 0.35;
      if (sel) {
        const touches = s.id === sel.id || d.id === sel.id;
        alpha = touches ? 0.85 : 0.03;
      } else if (ht) {
        const touches = s.type === ht || d.type === ht;
        alpha = touches ? 0.55 : 0.05;
      }
      ctx.strokeStyle = `rgba(${base}, ${alpha})`;
      ctx.lineWidth = (sel && (s.id === sel.id || d.id === sel.id) ? 2 : l.kind === "mention" ? 0.5 : 1) / scale;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
    }

    // nodes
    for (const node of nodesRef.current) {
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
      const isSel = sel && node.id === sel.id;
      const dim = sel ? !sel.neighbors.has(node.id) : ht && node.type !== ht;
      const r = nodeRadius(node);
      ctx.globalAlpha = dim ? 0.08 : 1;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI);
      ctx.fillStyle = TYPE_COLORS[node.type] || TYPE_COLORS.concept;
      ctx.fill();
      if (node.type === "document") {
        ctx.strokeStyle = "#e9ebdf";
        ctx.lineWidth = 0.7 / scale;
        ctx.stroke();
      }
      if (isSel || node.id === highlightRef.current) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 3, 0, 2 * Math.PI);
        ctx.strokeStyle = "#e9ebdf";
        ctx.lineWidth = 1.2 / scale;
        ctx.stroke();
      }
      const labelled = (sel && sel.neighbors.has(node.id)) || scale > 1.4 || (node.degree || 0) > 6;
      if (!dim && labelled && node.name) {
        ctx.font = `${Math.max(9 / scale, 2.4)}px "Space Grotesk", sans-serif`;
        ctx.fillStyle = "rgba(233, 235, 223, 0.85)";
        ctx.textAlign = "center";
        ctx.fillText(String(node.name).slice(0, 28), node.x, node.y + r + 5 / scale);
      }
      ctx.globalAlpha = 1;
    }
  }

  function screenToGraph(sx, sy) {
    const t = transformRef.current;
    return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
  }

  function hitTest(gx, gy) {
    let best = null, bestDist = Infinity;
    for (const n of nodesRef.current) {
      if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) continue;
      const dx = n.x - gx, dy = n.y - gy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = nodeRadius(n) + 4;
      if (dist <= r && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
    return best;
  }

  function canvasXY(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  async function selectNode(node) {
    const neighbors = new Set([node.id]);
    for (const l of linksRef.current) {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const d = typeof l.target === "object" ? l.target.id : l.target;
      if (s === node.id) neighbors.add(d);
      else if (d === node.id) neighbors.add(s);
    }
    selectedRef.current = { id: node.id, neighbors };
    highlightRef.current = null;
    if (!node.id.startsWith("e")) {
      setDetail(null); // document node: highlight only, no entity detail to fetch
      return;
    }
    try {
      const r = await fetch(`/api/graph/entity/${node.id.slice(1)}`);
      if (r.ok) setDetail(await r.json());
    } catch {
      /* transient network error — keep the highlight, skip the panel */
    }
  }

  function clearSelection() {
    selectedRef.current = null;
    setDetail(null);
  }

  function onMouseDown(e) {
    const { x, y } = canvasXY(e);
    const g = screenToGraph(x, y);
    const node = hitTest(g.x, g.y);
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
      // don't wake the whole simulation here — that made every node jitter
      // for as long as you were just moving one. The grabbed node is moved
      // directly below; everything else gets a single gentle settle on drop.
      dragRef.current = { mode: "node", node, moved: false, x0: e.clientX, y0: e.clientY };
    } else {
      dragRef.current = {
        mode: "pan",
        moved: false,
        x0: e.clientX,
        y0: e.clientY,
        tx0: transformRef.current.x,
        ty0: transformRef.current.y,
      };
    }
  }

  function onMouseMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x0) > 3 || Math.abs(e.clientY - drag.y0) > 3) drag.moved = true;
    if (drag.mode === "node") {
      const { x, y } = canvasXY(e);
      const g = screenToGraph(x, y);
      drag.node.fx = g.x;
      drag.node.fy = g.y;
      // apply immediately — fx/fy only take effect on a simulation tick, and
      // the sim is otherwise idle at rest, so without this the node wouldn't
      // move at all while the rest of the graph correctly stays put
      drag.node.x = g.x;
      drag.node.y = g.y;
    } else {
      transformRef.current = {
        ...transformRef.current,
        x: drag.tx0 + (e.clientX - drag.x0),
        y: drag.ty0 + (e.clientY - drag.y0),
      };
    }
  }

  function onMouseUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.mode === "node") {
      if (drag.moved) {
        // leave it exactly where it was dropped -- keep it pinned rather than
        // waking the simulation, which moved every other node for a moment
        // even though only one was ever meant to be repositioned
      } else {
        drag.node.fx = null;
        drag.node.fy = null;
        selectNode(drag.node); // a click, not a drag
      }
    } else if (!drag.moved) {
      clearSelection(); // background click
    }
  }

  function onWheel(e) {
    e.preventDefault();
    const { x, y } = canvasXY(e);
    const t = transformRef.current;
    const factor = Math.pow(1.0015, -e.deltaY);
    const k = Math.min(12, Math.max(0.12, t.k * factor));
    const gx = (x - t.x) / t.k, gy = (y - t.y) / t.k;
    transformRef.current = { k, x: x - gx * k, y: y - gy * k };
  }

  if (empty) {
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
            {meta ? `${meta.nodeCount} nodes · ${meta.linkCount} edges` : "loading"}
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

      <div style={{ position: "relative", paddingBottom: 48 }}>
        <div
          ref={wrapRef}
          className="deep"
          style={{
            minWidth: 0,
            border: "1px solid var(--rim)",
            overflow: "hidden",
            opacity: ready ? 1 : 0,
            transition: "opacity 0.5s var(--ease)",
          }}
        >
          {meta && (
            <canvas
              ref={canvasRef}
              width={sizeRef.current.w}
              height={sizeRef.current.h}
              style={{ display: "block", cursor: "grab" }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onWheel={onWheel}
            />
          )}
        </div>

        {detail && (
          <aside
            key={detail.name}
            className="card panel-slide"
            style={{
              // float over the graph instead of shrinking it — resizing the
              // canvas mid-interaction was one cause of the old blank-out
              position: "absolute",
              top: 16,
              right: 16,
              width: 340,
              maxHeight: "calc(100% - 80px)",
              overflowY: "auto",
              zIndex: 5,
              boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
              <h2 className="heading-sm" style={{ flex: 1 }}>{detail.name}</h2>
              <button className="link-quiet" onClick={clearSelection}>close</button>
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
