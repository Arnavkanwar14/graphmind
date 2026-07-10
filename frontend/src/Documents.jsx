import React, { useEffect, useRef, useState } from "react";

function fmtSize(b) {
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`;
}

const ICONS = {
  upload: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M2.5 13.5h11" strokeLinecap="square" />
    </svg>
  ),
  s3: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <ellipse cx="8" cy="3.6" rx="5.5" ry="2.1" />
      <path d="M2.5 3.6v8.8c0 1.16 2.46 2.1 5.5 2.1s5.5-.94 5.5-2.1V3.6" />
    </svg>
  ),
  drive: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2 12.5 6 5h4l4 7.5H2Z" strokeLinejoin="bevel" />
      <path d="M6 12.5 8 9" />
    </svg>
  ),
};

const CONNECTORS = [
  ["upload", "Direct upload", ".md, .txt, .pdf — encrypted before storage", false],
  ["s3", "Amazon S3", "Connect a bucket, sync its documents", true],
  ["drive", "Google Drive", "Connect a folder, sync its documents", true],
];

export default function Documents() {
  const [docs, setDocs] = useState([]);
  const [preview, setPreview] = useState(null); // {doc, chunks}
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef();

  async function refresh() {
    const r = await fetch("/api/documents");
    if (r.ok) setDocs(await r.json());
  }

  useEffect(() => {
    refresh();
  }, []);

  // poll while anything is still processing
  useEffect(() => {
    if (!docs.some((d) => d.status === "uploaded")) return;
    const t = setTimeout(refresh, 2000);
    return () => clearTimeout(t);
  }, [docs]);

  async function onFiles(files) {
    setUploading(files.length);
    setUploadError("");
    const failed = [];
    for (const f of files) {
      const form = new FormData();
      form.append("file", f);
      try {
        const r = await fetch("/api/documents", { method: "POST", body: form });
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          failed.push(`${f.name}: ${data.detail || r.status}`);
        }
      } catch {
        failed.push(`${f.name}: network error`);
      }
      setUploading((n) => n - 1);
    }
    if (failed.length) setUploadError(failed.join(" · "));
    refresh();
  }

  async function openPreview(doc) {
    const r = await fetch(`/api/documents/${doc.id}/chunks`);
    if (r.ok) setPreview({ doc, chunks: await r.json() });
  }

  async function remove(doc) {
    await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
    if (preview?.doc.id === doc.id) setPreview(null);
    refresh();
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow" style={{ marginBottom: 10 }}>
            Your knowledge base
          </p>
          <h1 className="heading-lg">Documents</h1>
        </div>
        <span className="spacer" />
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".md,.txt,.pdf"
          style={{ display: "none" }}
          onChange={(e) => {
            onFiles([...e.target.files]);
            e.target.value = "";
          }}
        />
        <button className="btn-pill" onClick={() => fileRef.current.click()}>
          {uploading ? `Uploading ${uploading}…` : "Upload files"}
        </button>
      </div>

      <div style={{ display: "flex", gap: 32, alignItems: "flex-start", paddingBottom: 80 }}>
        <section style={{ flex: "1 1 480px", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 28, flexWrap: "wrap" }}>
            {CONNECTORS.map(([icon, title, blurb, soon]) => (
              <div className={`connector${soon ? " disabled" : ""}`} key={icon}>
                <span className="conn-icon">{ICONS[icon]}</span>
                <div>
                  <p
                    className="eyebrow"
                    style={{ marginBottom: 4, display: "flex", gap: 8, alignItems: "center" }}
                  >
                    {title}
                    {soon && <span className="badge">soon</span>}
                  </p>
                  <p style={{ fontSize: 13, color: "var(--ash)", lineHeight: 1.45 }}>{blurb}</p>
                </div>
              </div>
            ))}
          </div>

          {uploadError && (
            <p className="error" style={{ marginBottom: 16 }}>
              {uploadError}
            </p>
          )}

          {docs.length === 0 && (
            <div className="card" style={{ textAlign: "center", padding: 56 }}>
              <p className="eyebrow" style={{ marginBottom: 8 }}>
                No documents yet
              </p>
              <p style={{ color: "var(--fog)" }}>
                Upload .md, .txt or .pdf files — they're encrypted before they're stored.
              </p>
            </div>
          )}

          {docs.map((d) => (
            <div
              key={d.id}
              className={`doc-row${d.status === "processed" ? " clickable" : ""}`}
              onClick={() => d.status === "processed" && openPreview(d)}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {d.filename}
                </div>
                <div className="micro" style={{ marginTop: 2 }}>
                  {fmtSize(d.size)}
                  {d.status === "processed" && ` · ${d.total_chunks} chunks`}
                  {d.status === "failed" && ` · ${d.error}`}
                </div>
              </div>
              <span
                className={`badge${d.status === "processed" ? " ok" : d.status === "failed" ? " failed" : ""}`}
              >
                {d.status === "uploaded" ? "processing…" : d.status}
              </span>
              <button
                className="btn-ghost-square"
                style={{ padding: "4px 10px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(d);
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </section>

        {preview && (
          <aside
            className="card"
            style={{ flex: "0 1 420px", maxHeight: "72vh", overflowY: "auto", position: "sticky", top: 84 }}
          >
            <div style={{ display: "flex", alignItems: "baseline", marginBottom: 16, gap: 12 }}>
              <p className="eyebrow" style={{ flex: 1, textTransform: "none", overflowWrap: "anywhere" }}>
                {preview.doc.filename}
              </p>
              <button className="link-quiet" onClick={() => setPreview(null)}>
                close
              </button>
            </div>
            {preview.chunks.map((c) => (
              <div key={c.seq} style={{ marginBottom: 18 }}>
                <p className="micro" style={{ marginBottom: 4, color: "var(--copper)" }}>
                  chunk {c.seq}
                  {c.page_no != null && ` · p. ${c.page_no}`}
                </p>
                <p style={{ color: "var(--fog)", fontSize: 14, whiteSpace: "pre-wrap" }}>{c.text}</p>
              </div>
            ))}
          </aside>
        )}
      </div>
    </>
  );
}
