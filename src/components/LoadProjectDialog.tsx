import { FileJson2, FileText, Link2, X } from "lucide-react";
import { useState } from "react";

export type ProjectInputs = {
  sourceType: "iiif" | "pdf";
  sourceText?: string;
  sourceData?: ArrayBuffer;
  sourceName: string;
  tsvText: string;
  tsvName: string;
};

type Props = {
  open: boolean;
  canClose: boolean;
  onClose: () => void;
  onLoad: (inputs: ProjectInputs) => Promise<void>;
};

async function fetchText(url: string, label: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} URLを読み込めませんでした。CORS設定とURLを確認してください。 ${detail}`);
  }
}

async function fetchData(url: string, label: string) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.arrayBuffer();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} URLを読み込めませんでした。CORS設定とURLを確認してください。 ${detail}`);
  }
}

export function LoadProjectDialog({ open, canClose, onClose, onLoad }: Props) {
  const [sourceType, setSourceType] = useState<"iiif" | "pdf">("iiif");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [tsvFile, setTsvFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [tsvUrl, setTsvUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function submit() {
    setError("");
    if (!sourceFile && !sourceUrl.trim()) {
      setError(`${sourceType === "iiif" ? "Manifest" : "PDF"}を指定してください。`);
      return;
    }
    setLoading(true);
    try {
      const tsvText = tsvFile ? await tsvFile.text() : tsvUrl.trim() ? await fetchText(tsvUrl.trim(), "TSV") : "";
      const sourceName = sourceFile?.name ?? sourceUrl.trim().split("/").pop() ?? (sourceType === "iiif" ? "manifest.json" : "document.pdf");
      const sourceText = sourceType === "iiif" ? (sourceFile ? await sourceFile.text() : await fetchText(sourceUrl.trim(), "Manifest")) : undefined;
      const sourceData = sourceType === "pdf" ? (sourceFile ? await sourceFile.arrayBuffer() : await fetchData(sourceUrl.trim(), "PDF")) : undefined;
      await onLoad({
        sourceType,
        sourceText,
        sourceData,
        sourceName,
        tsvText,
        tsvName: tsvFile?.name ?? (tsvUrl.trim() ? tsvUrl.trim().split("/").pop() || "ocr_all_pages.tsv" : "ocr_all_pages.tsv"),
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="load-dialog" role="dialog" aria-modal="true" aria-labelledby="load-title">
        <header className="dialog-header">
          <div>
            <p className="eyebrow">PROJECT</p>
            <h1 id="load-title">OCR Annotation Editor</h1>
          </div>
          {canClose ? (
            <button className="icon-button" type="button" onClick={onClose} title="閉じる" aria-label="閉じる"><X size={18} /></button>
          ) : null}
        </header>

        <div className="source-type-control segmented-control" aria-label="画像入力形式">
          <button
            type="button"
            className={sourceType === "iiif" ? "active" : ""}
            onClick={() => { setSourceType("iiif"); setSourceFile(null); setSourceUrl(""); setError(""); }}
          >IIIF Manifest</button>
          <button
            type="button"
            className={sourceType === "pdf" ? "active" : ""}
            onClick={() => { setSourceType("pdf"); setSourceFile(null); setSourceUrl(""); setError(""); }}
          >PDF</button>
        </div>

        <div className="load-grid">
          <label className="file-drop">
            <FileJson2 size={22} />
            <span>{sourceType === "iiif" ? "Manifest" : "PDF"}</span>
            <strong>{sourceFile?.name ?? (sourceType === "iiif" ? "JSONを選択" : "PDFを選択")}</strong>
            <input
              key={sourceType}
              type="file"
              accept={sourceType === "iiif" ? ".json,application/json" : ".pdf,application/pdf"}
              onChange={(event) => setSourceFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <label className="file-drop">
            <FileText size={22} />
            <span>OCR TSV（任意）</span>
            <strong>{tsvFile?.name ?? "TSVを選択"}</strong>
            <input type="file" accept=".tsv,text/tab-separated-values,text/plain" onChange={(event) => setTsvFile(event.target.files?.[0] ?? null)} />
          </label>
        </div>

        <div className="url-fields">
          <label>
            <span><Link2 size={14} /> {sourceType === "iiif" ? "Manifest URL" : "PDF URL"}</span>
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              placeholder={sourceType === "iiif" ? "https://…/manifest.json" : "https://…/document.pdf"}
            />
          </label>
          <label>
            <span><Link2 size={14} /> TSV URL（任意）</span>
            <input value={tsvUrl} onChange={(event) => setTsvUrl(event.target.value)} placeholder="https://…/ocr_all_pages.tsv" />
          </label>
        </div>

        {error ? <div className="error-banner" role="alert">{error}</div> : null}
        <footer className="dialog-actions">
          <button className="primary-button" type="button" disabled={loading} onClick={submit}>
            {loading ? "読み込み中" : "プロジェクトを開く"}
          </button>
        </footer>
      </section>
    </div>
  );
}
