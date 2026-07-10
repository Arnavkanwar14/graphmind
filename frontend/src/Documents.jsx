import React, { useEffect, useRef, useState } from "react";

function fmtSize(b) {
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`;
}

const STATUS_COLOR = {
  processed: "var(--forest)",
  failed: "#7a2e22",
  uploaded: "var(--moss)",
};

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
    <div style={{ display: "flex", gap: 32, padding: "40px 0", alignItems: "flex-start" }}>
      <section style={{ flex: "1 1 480px" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, marginBottom: 24 }}>
          <h1 style={{ fontWeight: 300, fontSize: 36, letterSpacing: "-0.36px" }}>Documents</h1>
          <span className="spacer" style={{ flex: 1 }} />
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".md,.txt,.pdf"
            style={{ display: "none" }}
            onChange={(e) => onFiles([...e.target.files])}
          />
          <button className="btn-pill" onClick={() => fileRef.current.click()}>
            {uploading ? `Uploading ${uploading}…` : "Upload files"}
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
          <div className="card" style={{ flex: 1, minWidth: 180, padding: 16, borderRadius: 8 }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>Direct upload</p>
            <p style={{ fontSize: 14, color: "var(--fog)" }}>
              .md, .txt, .pdf — encrypted before storage
            </p>
          </div>
          <div className="card" style={{ flex: 1, minWidth: 180, padding: 16, borderRadius: 8, opacity: 0.55 }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>
              Amazon S3 <span className="badge" style={{ marginLeft: 6 }}>soon</span>
            </p>
            <p style={{ fontSize: 14, color: "var(--fog)" }}>
              Connect a bucket, sync its documents
            </p>
          </div>
          <div className="card" style={{ flex: 1, minWidth: 180, padding: 16, borderRadius: 8, opacity: 0.55 }}>
            <p className="eyebrow" style={{ marginBottom: 4 }}>
              Google Drive <span className="badge" style={{ marginLeft: 6 }}>soon</span>
            </p>
            <p style={{ fontSize: 14, color: "var(--fog)" }}>
              Connect a folder, sync its documents
            </p>
          </div>
        </div>

        {uploadError && (
          <p className="error" style={{ marginBottom: 16 }}>
            {uploadError}
          </p>
        )}

        {docs.length === 0 && (
          <div className="card" style={{ textAlign: "center", padding: 56 }}>
            <p className="eyebrow" style={{ marginBottom: 8 }}>No documents yet</p>
            <p style={{ color: "var(--fog)" }}>
              Upload .md, .txt or .pdf files — they're encrypted before they're stored.
            </p>
          </div>
        )}

        {docs.map((d) => (
          <div
            key={d.id}
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "14px 20px",
              marginBottom: 8,
              borderRadius: 8,
              cursor: d.status === "processed" ? "pointer" : "default",
            }}
            onClick={() => d.status === "processed" && openPreview(d)}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {d.filename}
              </div>
              <div className="eyebrow" style={{ textTransform: "none", marginTop: 2 }}>
                {fmtSize(d.size)}
                {d.status === "processed" && ` · ${d.total_chunks} chunks`}
                {d.status === "failed" && ` · ${d.error}`}
              </div>
            </div>
            <span className="badge" style={{ background: STATUS_COLOR[d.status] }}>
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
        <aside className="card" style={{ flex: "0 1 420px", maxHeight: "75vh", overflowY: "auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", marginBottom: 16 }}>
            <p className="eyebrow" style={{ flex: 1, textTransform: "none" }}>
              {preview.doc.filename}
            </p>
            <button className="link-quiet" onClick={() => setPreview(null)}>
              close
            </button>
          </div>
          {preview.chunks.map((c) => (
            <div key={c.seq} style={{ marginBottom: 16 }}>
              <p className="eyebrow" style={{ marginBottom: 4 }}>
                chunk {c.seq}
                {c.page_no != null && ` · p. ${c.page_no}`}
              </p>
              <p style={{ color: "var(--fog)", fontSize: 14, whiteSpace: "pre-wrap" }}>{c.text}</p>
            </div>
          ))}
        </aside>
      )}
    </div>
  );
}
