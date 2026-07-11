import React, { useEffect, useRef, useState } from "react";

function fmtSize(b) {
  return b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`;
}

const ICONS = {
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

const POLLING_STATES = ["uploaded", "extracting"];

function S3Form({ onDone, onCancel }) {
  const [f, setF] = useState({ bucket: "", region: "us-east-1", prefix: "", access_key: "", secret_key: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/connectors/s3", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) onDone();
      else setErr(data.detail || "connection failed");
    } catch {
      setErr("can't reach the server");
    } finally {
      setBusy(false);
    }
  }

  const field = (key, label, type = "text") => (
    <div style={{ marginBottom: 12 }}>
      <label className="field-label">{label}</label>
      <input
        className="input"
        type={type}
        value={f[key]}
        required={key !== "prefix"}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <form className="card" onSubmit={submit} style={{ marginBottom: 28, maxWidth: 480 }}>
      <p className="eyebrow" style={{ marginBottom: 16 }}>Connect Amazon S3</p>
      {field("bucket", "Bucket name")}
      {field("region", "Region")}
      {field("prefix", "Prefix (optional)")}
      {field("access_key", "Access key ID")}
      {field("secret_key", "Secret access key", "password")}
      <p className="micro" style={{ marginBottom: 14 }}>
        Use a read-only IAM key (s3:GetObject + s3:ListBucket). Stored encrypted with your key.
      </p>
      {err && <p className="error" style={{ marginBottom: 12 }}>{err}</p>}
      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn-pill" disabled={busy}>{busy ? "checking…" : "Connect"}</button>
        <button type="button" className="btn-ghost-square" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export default function Documents() {
  const [docs, setDocs] = useState([]);
  const [preview, setPreview] = useState(null); // {doc, chunks}
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [drag, setDrag] = useState(false);
  const [conns, setConns] = useState([]);
  const [showS3Form, setShowS3Form] = useState(false);
  const [connMsg, setConnMsg] = useState("");
  const fileRef = useRef();

  async function refresh() {
    const r = await fetch("/api/documents");
    if (r.ok) setDocs(await r.json());
  }

  async function refreshConns() {
    const r = await fetch("/api/connectors");
    if (r.ok) setConns(await r.json());
  }

  useEffect(() => {
    refresh();
    refreshConns();
    const drive = new URLSearchParams(window.location.search).get("drive");
    if (drive) {
      setConnMsg(drive === "connected" ? "Google Drive connected — hit Sync now to pull your files." : "Google Drive connection was cancelled.");
      window.history.replaceState(null, "", "/");
    }
  }, []);

  async function connectDrive() {
    setConnMsg("");
    const r = await fetch("/api/connectors/gdrive/auth");
    const data = await r.json().catch(() => ({}));
    if (r.ok) window.location.href = data.url;
    else setConnMsg(data.detail || "Drive connection failed");
  }

  async function syncConn(c) {
    await fetch(`/api/connectors/${c.id}/sync`, { method: "POST" });
    refreshConns();
    setTimeout(() => {
      refresh();
      refreshConns();
    }, 4000);
  }

  async function dropConn(c) {
    await fetch(`/api/connectors/${c.id}`, { method: "DELETE" });
    refreshConns();
  }

  useEffect(() => {
    if (!docs.some((d) => POLLING_STATES.includes(d.status))) return;
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
      refresh();
    }
    if (failed.length) setUploadError(failed.join(" · "));
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

  const totalChunks = docs.reduce((n, d) => n + d.total_chunks, 0);
  const totalBytes = docs.reduce((n, d) => n + d.size, 0);

  function statusBadge(d) {
    if (d.status === "processed") return <span className="badge ok">ready</span>;
    if (d.status === "failed") return <span className="badge failed">failed</span>;
    if (d.status === "extracting")
      return (
        <span className="badge working">
          building graph {d.total_chunks ? Math.round((100 * d.processed_chunks) / d.total_chunks) : 0}%
        </span>
      );
    return <span className="badge working">processing…</span>;
  }

  return (
    <>
      <div className="page-head rise">
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

      <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 28 }}>
        <div className="stat rise">
          <p className="stat-value">{docs.length}</p>
          <p className="micro" style={{ marginTop: 6 }}>documents</p>
        </div>
        <div className="stat rise" style={{ animationDelay: "40ms" }}>
          <p className="stat-value">{totalChunks}</p>
          <p className="micro" style={{ marginTop: 6 }}>chunks indexed</p>
        </div>
        <div className="stat rise" style={{ animationDelay: "80ms" }}>
          <p className="stat-value">{totalBytes ? fmtSize(totalBytes) : "0 KB"}</p>
          <p className="micro" style={{ marginTop: 6 }}>encrypted at rest</p>
        </div>
        {[
          ["s3", "Amazon S3"],
          ["drive", "Google Drive"],
        ].map(([kind, title]) => {
          const conn = conns.find((c) => c.kind === (kind === "drive" ? "gdrive" : kind));
          return (
            <div className="stat rise" key={kind} style={{ display: "flex", gap: 12, alignItems: "flex-start", animationDelay: kind === "drive" ? "60ms" : "0ms" }}>
              <span className="conn-icon">{ICONS[kind]}</span>
              <div style={{ minWidth: 0 }}>
                <p className="micro" style={{ color: "var(--limestone)", display: "flex", gap: 6, alignItems: "center" }}>
                  {title}
                  {conn && <span className="badge ok">connected</span>}
                </p>
                {conn ? (
                  <>
                    <p className="micro" style={{ overflowWrap: "anywhere" }}>
                      {conn.label}
                      {conn.last_result && ` — ${conn.last_result}`}
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                      <button className="btn-ghost-square" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => syncConn(conn)}>
                        Sync now
                      </button>
                      <button className="link-quiet" onClick={() => dropConn(conn)}>disconnect</button>
                    </div>
                  </>
                ) : (
                  <button
                    className="btn-ghost-square"
                    style={{ padding: "2px 8px", fontSize: 12, marginTop: 6 }}
                    onClick={() => (kind === "s3" ? setShowS3Form(true) : connectDrive())}
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {connMsg && <p className="error" style={{ marginBottom: 16 }}>{connMsg}</p>}
      {showS3Form && (
        <S3Form
          onDone={() => {
            setShowS3Form(false);
            refreshConns();
          }}
          onCancel={() => setShowS3Form(false)}
        />
      )}

      <div style={{ display: "flex", gap: 32, alignItems: "flex-start", paddingBottom: 80 }}>
        <section style={{ flex: "1 1 480px", minWidth: 0 }}>
          <div
            className={`dropzone rise${drag ? " drag" : ""}`}
            onClick={() => fileRef.current.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              onFiles([...e.dataTransfer.files]);
            }}
          >
            <p className="eyebrow" style={{ marginBottom: 6 }}>
              Drop files here
            </p>
            <p className="micro">.md · .txt · .pdf — up to 10 MB each, encrypted with your key</p>
          </div>

          {uploadError && (
            <p className="error" style={{ marginBottom: 16 }}>
              {uploadError}
            </p>
          )}

          {docs.map((d, i) => (
            <div
              key={d.id}
              className={`doc-row rise${d.status === "processed" ? " clickable" : ""}`}
              style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              onClick={() => d.status === "processed" && openPreview(d)}
            >
              <span className="filetype-chip">{d.filename.split(".").pop()}</span>
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
              {statusBadge(d)}
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
