import { Check, ChevronDown, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AnnotationStatus, OcrRecord, Rect } from "../types";
import { recordRect } from "../lib/geometry";

type Props = {
  record: OcrRecord | null;
  onTextChange: (id: string, text: string) => void;
  onStatusChange: (id: string, status: AnnotationStatus) => void;
  onGeometryChange: (id: string, rect: Rect) => void;
  onDelete: (id: string) => void;
};

export function AnnotationInspector({ record, onTextChange, onStatusChange, onGeometryChange, onDelete }: Props) {
  const [text, setText] = useState("");
  const [geometry, setGeometry] = useState<Rect>({ x: 0, y: 0, w: 1, h: 1 });

  useEffect(() => {
    setText(record?.text ?? "");
    if (record) setGeometry(recordRect(record));
  }, [record?.annotation_id, record?.text, record?.x, record?.y, record?.w, record?.h]);

  if (!record) return <div className="inspector-empty">Annotationを選択</div>;

  function commitText() {
    if (text !== record!.text) onTextChange(record!.annotation_id, text);
  }

  function commitGeometry() {
    onGeometryChange(record!.annotation_id, geometry);
  }

  return (
    <section className="inspector" aria-label="選択Annotation">
      <div className="inspector-heading">
        <div>
          <span className="annotation-number">#{record.page || "-"} / {record.row || "-"}-{record.col || "-"}</span>
          <code title={record.annotation_id}>{record.annotation_id}</code>
        </div>
        <button className="danger-icon-button" type="button" title="Annotationを削除" aria-label="Annotationを削除" onClick={() => onDelete(record.annotation_id)}><Trash2 size={17} /></button>
      </div>

      <label className="field-stack">
        <span>OCRテキスト</span>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commitText}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
              event.preventDefault();
              commitText();
            }
          }}
        />
      </label>

      <div className="inspector-meta">
        <label className="field-stack">
          <span>信頼度</span>
          <input readOnly value={record.confidence} />
        </label>
        <label className="field-stack">
          <span>状態</span>
          <select value={record.status || "machine"} onChange={(event) => onStatusChange(record.annotation_id, event.target.value as AnnotationStatus)}>
            <option value="machine">machine</option>
            <option value="verified">verified</option>
            <option value="corrected">corrected</option>
          </select>
        </label>
      </div>

      <div className="inspector-actions">
        <button className="subtle-button" type="button" onClick={() => onStatusChange(record.annotation_id, "verified")}><Check size={15} />確認済み</button>
      </div>

      <details className="coordinate-details">
        <summary><ChevronDown size={13} />座標 <code>{geometry.x}, {geometry.y}, {geometry.w}, {geometry.h}</code></summary>
        <div className="coordinate-grid">
          {(["x", "y", "w", "h"] as const).map((key) => (
            <label key={key}>
              <span>{key}</span>
              <input
                type="number"
                min={key === "w" || key === "h" ? 1 : 0}
                value={geometry[key]}
                onChange={(event) => setGeometry((previous) => ({ ...previous, [key]: Number(event.target.value) }))}
              />
            </label>
          ))}
        </div>
        <button className="subtle-button coordinate-apply" type="button" onClick={commitGeometry}><Save size={14} />適用</button>
      </details>
    </section>
  );
}
