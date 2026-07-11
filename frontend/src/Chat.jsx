import React, { useEffect, useRef, useState } from "react";

function AnswerText({ text }) {
  // render [n] markers as citation sups
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        if (!m) return p;
        return (
          <sup
            key={i}
            style={{
              fontFamily: "var(--grotesk)",
              fontSize: 11,
              color: "var(--coral)",
              padding: "0 2px",
            }}
          >
            [{m[1]}]
          </sup>
        );
      })}
    </p>
  );
}

export default function Chat({ onShowEntity }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [openCite, setOpenCite] = useState(null); // `${msgIdx}-${n}`
  const endRef = useRef();

  useEffect(() => {
    fetch("/api/chat/history")
      .then((r) => (r.ok ? r.json() : []))
      .then(setMessages)
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  async function send(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q || busy) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((ms) => [...ms, { role: "user", content: q }]);
    setBusy(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, history }),
      });
      const data = await r.json().catch(() => ({}));
      setMessages((ms) => [
        ...ms,
        r.ok
          ? { role: "assistant", content: data.answer, citations: data.citations, entities: data.entities }
          : { role: "assistant", content: data.detail || "something went wrong" },
      ]);
    } catch {
      setMessages((ms) => [
        ...ms,
        { role: "assistant", content: "can't reach the server — try again in a moment" },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 780, margin: "0 auto", display: "flex", flexDirection: "column", minHeight: "calc(100vh - 60px)" }}>
      <div style={{ flex: 1, padding: "40px 0 24px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "72px 24px" }}>
            <p className="eyebrow" style={{ marginBottom: 12 }}>Chat</p>
            <h1 className="heading-lg" style={{ marginBottom: 12 }}>
              Ask your documents.
            </h1>
            <p style={{ color: "var(--fog)", maxWidth: 440, margin: "0 auto" }}>
              Answers come with citations and the graph path they took. Try
              &ldquo;What is Truss and what does it compile with?&rdquo;
            </p>
          </div>
        )}

        {messages.map((m, mi) => (
          <div key={mi} className="rise" style={{ marginBottom: 24, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div
              className={m.role === "user" ? "card" : ""}
              style={
                m.role === "user"
                  ? { padding: "12px 18px", borderRadius: 8, maxWidth: "80%" }
                  : { maxWidth: "94%", width: "100%" }
              }
            >
              {m.role === "assistant" && (
                <p className="micro" style={{ color: "var(--copper)", marginBottom: 6 }}>
                  GraphMind
                </p>
              )}
              {m.role === "user" ? <p>{m.content}</p> : <AnswerText text={m.content} />}

              {m.citations?.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {m.citations.filter((c) => m.content.includes(`[${c.n}]`)).map((c, ci) => (
                      <button
                        key={c.n}
                        className="btn-ghost-square rise"
                        style={{ padding: "3px 10px", fontSize: 12, fontFamily: "var(--grotesk)", animationDelay: `${ci * 60}ms` }}
                        onClick={() => setOpenCite(openCite === `${mi}-${c.n}` ? null : `${mi}-${c.n}`)}
                      >
                        [{c.n}] {c.document.length > 26 ? c.document.slice(0, 24) + "…" : c.document}
                        {c.page_no != null && ` · p.${c.page_no}`}
                      </button>
                    ))}
                    {(() => {
                      const uncited = m.citations.filter((c) => !m.content.includes(`[${c.n}]`)).length;
                      return uncited > 0 ? (
                        <span className="micro">+{uncited} more source{uncited === 1 ? "" : "s"} searched</span>
                      ) : null;
                    })()}
                  </div>
                  {m.citations.map(
                    (c) =>
                      openCite === `${mi}-${c.n}` && (
                        <div key={c.n} className="deep" style={{ border: "1px solid var(--rim)", padding: 16, marginTop: 10 }}>
                          <p className="micro" style={{ color: "var(--copper)", marginBottom: 6 }}>
                            [{c.n}] {c.document}
                            {c.page_no != null && ` · p. ${c.page_no}`}
                          </p>
                          <p style={{ fontSize: 14, color: "var(--fog)" }}>{c.excerpt}…</p>
                        </div>
                      )
                  )}
                </div>
              )}

              {m.entities?.length > 0 && (
                <div style={{ marginTop: 12, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span className="micro">in the graph:</span>
                  {m.entities.slice(0, 6).map((en) => (
                    <button
                      key={en.id}
                      className="badge"
                      style={{ border: "none", cursor: "pointer" }}
                      onClick={() => onShowEntity(en.id)}
                    >
                      {en.name} ↗
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <p className="micro" style={{ color: "var(--copper)", display: "flex", alignItems: "center", gap: 8 }}>
            tracing the graph
            <span className="typing-dots">
              <span />
              <span />
              <span />
            </span>
          </p>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} style={{ position: "sticky", bottom: 0, background: "var(--canvas)", padding: "16px 0 28px", display: "flex", gap: 10 }}>
        <input
          className="input"
          style={{ flex: 1, transition: "border-color 0.25s var(--ease), box-shadow 0.25s var(--ease)" }}
          placeholder="Ask about your documents…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn-pill" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
