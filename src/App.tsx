import {
  BoxSelect,
  Check,
  ChevronLeft,
  ChevronRight,
  Combine,
  Download,
  FileJson2,
  FolderOpen,
  Home,
  Layers,
  ListOrdered,
  Minus,
  Plus,
  Redo2,
  Search,
  SquareDashed,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnnotationInspector } from "./components/AnnotationInspector";
import { AnnotationList } from "./components/AnnotationList";
import { IiifViewer } from "./components/IiifViewer";
import { LoadProjectDialog, type ProjectInputs } from "./components/LoadProjectDialog";
import { downloadText } from "./lib/download";
import { normalizeGeometryForExport, numberValue, recordRect, synchronizeGeometry } from "./lib/geometry";
import { parseManifest } from "./lib/iiif";
import { loadSavedProject, projectStorageKey, saveProject } from "./lib/persistence";
import { correctedFilename, createEmptyDataset, parseTsv, serializeTsv } from "./lib/tsv";
import type { AnnotationStatus, OcrRecord, ParsedManifest, Rect, SavedProject } from "./types";

type ViewerTool = "select" | "add";
type SortMode = "manual" | "reading" | "confidence-asc" | "confidence-desc";

function sameRecord(a: OcrRecord, b: OcrRecord) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(keys).every((key) => a[key] === b[key]);
}

function annotationCollection(manifest: ParsedManifest, records: OcrRecord[]) {
  return {
    "@context": "http://iiif.io/api/presentation/3/context.json",
    id: `${manifest.id.replace(/\/$/, "")}/annotations/ocr-corrected`,
    type: "AnnotationCollection",
    label: { ja: [`${manifest.label} OCR校正`] },
    items: manifest.canvases.flatMap((canvas, canvasIndex) => {
      const items = records.filter((record) => record.canvas_id === canvas.id).map((record) => ({
        id: record.annotation_id,
        type: "Annotation",
        motivation: "supplementing",
        body: {
          type: "TextualBody",
          value: record.text,
          format: "text/plain",
          language: "ja",
        },
        target: record.target,
      }));
      return items.length > 0 ? [{
        id: `${canvas.id.replace(/\/$/, "")}/annotations/ocr-corrected-${canvasIndex + 1}`,
        type: "AnnotationPage",
        items,
      }] : [];
    }),
  };
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

export function App() {
  const [manifest, setManifest] = useState<ParsedManifest | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [records, setRecords] = useState<OcrRecord[]>([]);
  const [sourceName, setSourceName] = useState("ocr_all_pages.tsv");
  const [tsvFingerprint, setTsvFingerprint] = useState("");
  const [canvasIndex, setCanvasIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [tool, setTool] = useState<ViewerTool>("select");
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderIds, setReorderIds] = useState<string[]>([]);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [showCells, setShowCells] = useState(false);
  const [showExisting, setShowExisting] = useState(false);
  const [confidenceThreshold, setConfidenceThreshold] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState<SortMode>("manual");
  const [loadOpen, setLoadOpen] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState("ManifestまたはPDFを開いてください。TSVは任意です。");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [past, setPast] = useState<OcrRecord[][]>([]);
  const [future, setFuture] = useState<OcrRecord[][]>([]);
  const viewerApiRef = useRef<{ zoomBy: (factor: number) => void; home: () => void } | null>(null);

  const canvas = manifest?.canvases[canvasIndex] ?? null;
  const pageRecords = useMemo(
    () => canvas ? records.filter((record) => record.canvas_id === canvas.id) : [],
    [canvas, records],
  );
  const selected = records.find((record) => record.annotation_id === selectedId) ?? null;
  const filteredRecords = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ja");
    return pageRecords
      .filter((record) => !query || record.text.toLocaleLowerCase("ja").includes(query) || record.annotation_id.toLocaleLowerCase().includes(query))
      .filter((record) => statusFilter === "all" || (record.status || "machine") === statusFilter)
      .filter((record) => numberValue(record.confidence, 1) >= confidenceThreshold)
      .sort((a, b) => {
        if (sortMode === "manual") return 0;
        if (sortMode === "confidence-asc") return numberValue(a.confidence) - numberValue(b.confidence);
        if (sortMode === "confidence-desc") return numberValue(b.confidence) - numberValue(a.confidence);
        const aRect = recordRect(a);
        const bRect = recordRect(b);
        return aRect.y - bRect.y || aRect.x - bRect.x;
      });
  }, [pageRecords, search, statusFilter, sortMode, confidenceThreshold]);
  const counts = useMemo(() => ({
    total: pageRecords.length,
    corrected: pageRecords.filter((record) => record.status === "corrected").length,
    unconfirmed: pageRecords.filter((record) => !record.status || record.status === "machine").length,
  }), [pageRecords]);
  const projectKey = manifest && tsvFingerprint ? projectStorageKey(manifest.id, tsvFingerprint) : "";

  const reportViewerError = useCallback((errorMessage: string) => setMessage(errorMessage), []);

  function commitRecords(nextRecords: OcrRecord[]) {
    if (nextRecords === records) return;
    setPast((previous) => [...previous.slice(-49), records]);
    setFuture([]);
    setRecords(nextRecords);
    setDirty(true);
  }

  function updateRecord(id: string, mutate: (record: OcrRecord) => OcrRecord) {
    let changed = false;
    const next = records.map((record) => {
      if (record.annotation_id !== id) return record;
      const updated = mutate(record);
      changed = !sameRecord(record, updated);
      return updated;
    });
    if (changed) commitRecords(next);
  }

  function updateGeometry(id: string, rect: Rect) {
    updateRecord(id, (record) => synchronizeGeometry(record, rect));
  }

  function updateText(id: string, text: string) {
    updateRecord(id, (record) => ({ ...record, text, status: "corrected" }));
  }

  function updateStatus(id: string, status: AnnotationStatus) {
    updateRecord(id, (record) => ({ ...record, status }));
  }

  function deleteRecord(id: string) {
    const record = records.find((item) => item.annotation_id === id);
    if (!record || !window.confirm("選択したAnnotationを削除しますか？")) return;
    commitRecords(records.filter((item) => item.annotation_id !== id));
    setSelectedId(null);
    setMessage("Annotationを削除しました。Undoで復元できます。");
  }

  function addRecord(rect: Rect) {
    if (!canvas || !manifest) return;
    const existingIds = new Set(records.map((record) => record.annotation_id));
    let suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    let id = `${canvas.id.replace(/\/$/, "")}/annotations/ocr-manual-${suffix}`;
    while (existingIds.has(id)) {
      suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
      id = `${canvas.id.replace(/\/$/, "")}/annotations/ocr-manual-${suffix}`;
    }
    const reference = pageRecords[0];
    const record: OcrRecord = Object.fromEntries(columns.map((column) => [column, ""]));
    Object.assign(record, {
      annotation_id: id,
      canvas_id: canvas.id,
      page: String(canvasIndex + 1),
      image_file: reference?.image_file ?? "",
      text: "",
      confidence: "",
      mode: "manual",
      image_width: reference?.image_width || String(canvas.width),
      image_height: reference?.image_height || String(canvas.height),
      canvas_width: String(canvas.width),
      canvas_height: String(canvas.height),
      status: "corrected",
    });
    const synchronized = synchronizeGeometry(record, rect);
    commitRecords([...records, synchronized]);
    setSelectedId(id);
    setFocusToken((value) => value + 1);
    setMessage("Annotationを追加しました。");
  }

  function startMerge() {
    setTool("select");
    setReorderMode(false);
    setReorderIds([]);
    setMergeMode(true);
    setMergeIds([]);
    setMessage("結合するAnnotationを順に選択してください。");
  }

  function cancelMerge() {
    setMergeMode(false);
    setMergeIds([]);
    setMessage("マージを中止しました。");
  }

  function pickMergeAnnotation(id: string) {
    setSelectedId(id);
    setMergeIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  }

  function mergeAnnotations() {
    const targets = mergeIds.map((id) => records.find((record) => record.annotation_id === id)).filter((record): record is OcrRecord => Boolean(record));
    if (targets.length < 2) {
      setMessage("2件以上のAnnotationを選択してください。");
      return;
    }
    const first = targets[0];
    const rects = targets.map(recordRect);
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.w));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
    const merged = synchronizeGeometry(
      { ...first, text: targets.map((record) => record.text).join(""), status: "corrected" },
      { x: left, y: top, w: right - left, h: bottom - top },
    );
    const removedIds = new Set(mergeIds.slice(1));
    const nextRecords = records.flatMap((record) => {
      if (record.annotation_id === first.annotation_id) return [merged];
      return removedIds.has(record.annotation_id) ? [] : [record];
    });
    commitRecords(nextRecords);
    setSelectedId(first.annotation_id);
    setMergeMode(false);
    setMergeIds([]);
    setMessage(`${targets.length}件のAnnotationを結合しました。`);
  }

  function startReorder() {
    setTool("select");
    setMergeMode(false);
    setMergeIds([]);
    setReorderMode(true);
    setReorderIds([]);
    setSortMode("manual");
    setMessage("Annotationを希望する順番で選択してください。");
  }

  function cancelReorder() {
    setReorderMode(false);
    setReorderIds([]);
    setMessage("並び替えを中止しました。");
  }

  function pickReorderAnnotation(id: string) {
    setSelectedId(id);
    setReorderIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  }

  function commitPageOrder(nextPageRecords: OcrRecord[]) {
    if (!canvas || nextPageRecords.length !== pageRecords.length) return;
    let pageOffset = 0;
    const nextRecords = records.map((record) => record.canvas_id === canvas.id ? nextPageRecords[pageOffset++] : record);
    commitRecords(nextRecords);
    setSortMode("manual");
  }

  function applyReorder() {
    const orderedRecords = reorderIds.map((id) => pageRecords.find((record) => record.annotation_id === id)).filter((record): record is OcrRecord => Boolean(record));
    if (orderedRecords.length < 2) {
      setMessage("2件以上のAnnotationを選択してください。");
      return;
    }
    const selectedIds = new Set(reorderIds);
    const selectedPositions = pageRecords.flatMap((record, index) => selectedIds.has(record.annotation_id) ? [index] : []);
    const nextPageRecords = [...pageRecords];
    selectedPositions.forEach((position, index) => {
      nextPageRecords[position] = orderedRecords[index];
    });
    commitPageOrder(nextPageRecords);
    setSelectedId(orderedRecords[0].annotation_id);
    setReorderMode(false);
    setReorderIds([]);
    setMessage(`${orderedRecords.length}件のAnnotationを並び替えました。`);
  }

  function undo() {
    const previous = past.at(-1);
    if (!previous) return;
    setFuture((items) => [records, ...items].slice(0, 50));
    setPast((items) => items.slice(0, -1));
    setRecords(previous);
    if (selectedId && !previous.some((record) => record.annotation_id === selectedId)) setSelectedId(null);
    setDirty(true);
  }

  function redo() {
    const next = future[0];
    if (!next) return;
    setPast((items) => [...items.slice(-49), records]);
    setFuture((items) => items.slice(1));
    setRecords(next);
    setDirty(true);
  }

  function selectAnnotation(id: string, focus = false) {
    setSelectedId(id);
    setTool("select");
    if (focus) setFocusToken((value) => value + 1);
  }

  function changePage(nextIndex: number) {
    if (!manifest) return;
    const safeIndex = Math.max(0, Math.min(manifest.canvases.length - 1, nextIndex));
    setCanvasIndex(safeIndex);
    setSelectedId(null);
    setTool("select");
    setMergeMode(false);
    setMergeIds([]);
    setReorderMode(false);
    setReorderIds([]);
  }

  async function loadProject(input: ProjectInputs) {
    if (dirty && !window.confirm("未エクスポートの変更があります。別のプロジェクトを開きますか？")) return;
    let parsedManifest: ParsedManifest;
    if (input.sourceType === "iiif") {
      let manifestJson: unknown;
      try {
        manifestJson = JSON.parse(input.sourceText ?? "");
      } catch {
        throw new Error("Manifest JSONを解析できませんでした。");
      }
      parsedManifest = parseManifest(manifestJson);
    } else {
      if (!input.sourceData) throw new Error("PDFデータを読み込めませんでした。");
      const { parsePdf } = await import("./lib/pdf");
      parsedManifest = await parsePdf(input.sourceData, input.sourceName, input.tsvText);
    }
    const hasInputTsv = Boolean(input.tsvText.trim());
    const dataset = hasInputTsv
      ? await parseTsv(input.tsvText, input.tsvName, parsedManifest.canvases)
      : await createEmptyDataset(input.tsvName);
    const nextProjectKey = projectStorageKey(parsedManifest.id, dataset.fingerprint);
    const saved = await loadSavedProject(nextProjectKey).catch(() => undefined);
    const restore = saved && window.confirm(`自動保存された編集（${new Date(saved.savedAt).toLocaleString("ja-JP")}）を復元しますか？`);
    const loadedRecords = restore ? saved.records : dataset.records;
    const loadedColumns = restore ? saved.columns : dataset.columns;
    setManifest(parsedManifest);
    setRecords(loadedRecords);
    setColumns(loadedColumns);
    setSourceName(dataset.sourceName);
    setTsvFingerprint(dataset.fingerprint);
    setCanvasIndex(restore ? Math.min(saved.canvasIndex, parsedManifest.canvases.length - 1) : 0);
    setSelectedId(restore ? saved.selectedId : null);
    setMergeMode(false);
    setMergeIds([]);
    setReorderMode(false);
    setReorderIds([]);
    setPast([]);
    setFuture([]);
    setWarnings(dataset.warnings);
    setDirty(restore ? saved.dirty : false);
    setLoadOpen(false);
    setShowExisting(false);
    setMessage(hasInputTsv
      ? `${input.sourceType === "iiif" ? "Manifest" : "PDF"} ${parsedManifest.canvases.length}ページ / ${loadedRecords.length}件を読み込みました。`
      : `${input.sourceType === "iiif" ? "Manifest" : "PDF"} ${parsedManifest.canvases.length}ページから新規作成を開始しました。`);
  }

  function exportTsv() {
    if (!manifest) return;
    const normalizedRecords = records.map(normalizeGeometryForExport);
    downloadText(serializeTsv(normalizedRecords, columns), correctedFilename(sourceName), "text/tab-separated-values;charset=utf-8");
    setDirty(false);
    setMessage(`${records.length}件をTSVへ書き出しました。`);
  }

  function exportJson() {
    if (!manifest) return;
    const filename = correctedFilename(sourceName).replace(/\.tsv$/i, ".annotations.json");
    downloadText(`${JSON.stringify(annotationCollection(manifest, records.map(normalizeGeometryForExport)), null, 2)}\n`, filename, "application/json;charset=utf-8");
  }

  useEffect(() => {
    if (!projectKey || !manifest) return;
    setSaveState("saving");
    const timer = window.setTimeout(() => {
      const saved: SavedProject = {
        version: 1,
        projectKey,
        manifestId: manifest.id,
        tsvFingerprint,
        columns,
        records,
        sourceName,
        canvasIndex,
        selectedId,
        dirty,
        savedAt: Date.now(),
      };
      saveProject(saved).then(() => setSaveState("saved")).catch(() => setSaveState("error"));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [projectKey, manifest, tsvFingerprint, columns, records, sourceName, canvasIndex, selectedId, dirty]);

  useEffect(() => {
    function warn(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && key === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
        return;
      }
      if (modifier && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (modifier && key === "e") {
        event.preventDefault();
        exportTsv();
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (!modifier && !event.altKey && key === "m" && !mergeMode) {
        event.preventDefault();
        event.stopPropagation();
        startMerge();
        return;
      }
      if (!modifier && !event.altKey && key === "r" && !reorderMode) {
        event.preventDefault();
        event.stopPropagation();
        startReorder();
        return;
      }
      if (event.key === "Escape" && mergeMode) {
        event.preventDefault();
        cancelMerge();
        return;
      }
      if (event.key === "Escape" && reorderMode) {
        event.preventDefault();
        cancelReorder();
        return;
      }
      if (event.key === "Enter" && mergeMode) {
        event.preventDefault();
        mergeAnnotations();
        return;
      }
      if (event.key === "Enter" && reorderMode) {
        event.preventDefault();
        applyReorder();
        return;
      }
      if (event.key === "ArrowLeft") changePage(canvasIndex - 1);
      if (event.key === "ArrowRight") changePage(canvasIndex + 1);
      if (key === "v" && !mergeMode && !reorderMode) setTool("select");
      if (key === "n" && !mergeMode && !reorderMode) setTool("add");
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !mergeMode && !reorderMode) deleteRecord(selectedId);
    }
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  });

  return (
    <div className="app-shell">
      <LoadProjectDialog open={loadOpen} canClose={Boolean(manifest)} onClose={() => setLoadOpen(false)} onLoad={loadProject} />

      <header className="app-header">
        <div className="brand-block">
          <span className="brand-mark">{manifest?.sourceType === "pdf" ? "PDF" : "OCR"}</span>
          <div>
            <strong>{manifest?.label ?? "OCR Annotation Editor"}</strong>
            <span>{sourceName}</span>
          </div>
        </div>

        <div className="page-controls">
          <button className="icon-button" type="button" disabled={!manifest || canvasIndex === 0} onClick={() => changePage(canvasIndex - 1)} title="前のページ"><ChevronLeft size={18} /></button>
          <select value={canvasIndex} disabled={!manifest} onChange={(event) => changePage(Number(event.target.value))}>
            {manifest?.canvases.map((item, index) => <option value={index} key={item.id}>{index + 1} / {manifest.canvases.length}　{item.label}</option>)}
          </select>
          <button className="icon-button" type="button" disabled={!manifest || canvasIndex >= manifest.canvases.length - 1} onClick={() => changePage(canvasIndex + 1)} title="次のページ"><ChevronRight size={18} /></button>
        </div>

        <div className="header-actions">
          <span className={`save-indicator save-${saveState}`}>{saveState === "saving" ? "保存中" : saveState === "error" ? "保存失敗" : dirty ? "未出力" : "保存済"}</span>
          <button className="subtle-button" type="button" onClick={() => setLoadOpen(true)}><FolderOpen size={16} />開く</button>
          <button className="subtle-button" type="button" disabled={!manifest} onClick={exportJson}><FileJson2 size={16} />JSON</button>
          <button className="primary-button" type="button" disabled={!manifest} onClick={exportTsv}><Download size={16} />TSVを書き出す</button>
        </div>
      </header>

      <main className="workspace">
        <section className="viewer-column">
          <div className="viewer-toolbar">
            <div className="segmented-control" aria-label="編集ツール">
              <button type="button" disabled={mergeMode || reorderMode} className={tool === "select" ? "active" : ""} onClick={() => setTool("select")} title="選択 (V)"><BoxSelect size={17} />選択</button>
              <button type="button" disabled={mergeMode || reorderMode} className={tool === "add" ? "active" : ""} onClick={() => setTool("add")} title="領域追加 (N)"><SquareDashed size={17} />追加</button>
            </div>
            {!mergeMode && !reorderMode ? (
              <div className="sequence-buttons">
                <button className="subtle-button" type="button" onClick={startMerge} title="マージ (M)"><Combine size={16} />マージ</button>
                <button className="subtle-button" type="button" onClick={startReorder} title="並び替え (R)"><ListOrdered size={16} />並び替え</button>
              </div>
            ) : mergeMode ? (
              <div className="merge-controls">
                <span>{mergeIds.length}件</span>
                <button className="primary-button" type="button" disabled={mergeIds.length < 2} onClick={mergeAnnotations}><Check size={15} />結合</button>
                <button className="icon-button" type="button" onClick={cancelMerge} title="マージを中止"><X size={16} /></button>
              </div>
            ) : (
              <div className="reorder-controls">
                <span>{reorderIds.length}件</span>
                <button className="primary-button" type="button" disabled={reorderIds.length < 2} onClick={applyReorder}><Check size={15} />適用</button>
                <button className="icon-button" type="button" onClick={cancelReorder} title="並び替えを中止"><X size={16} /></button>
              </div>
            )}
            <div className="toolbar-group">
              <button className="icon-button" type="button" disabled={past.length === 0} onClick={undo} title="元に戻す"><Undo2 size={17} /></button>
              <button className="icon-button" type="button" disabled={future.length === 0} onClick={redo} title="やり直す"><Redo2 size={17} /></button>
            </div>
            <div className="toolbar-group">
              <button className="icon-button" type="button" onClick={() => viewerApiRef.current?.zoomBy(1.4)} title="拡大"><Plus size={17} /></button>
              <button className="icon-button" type="button" onClick={() => viewerApiRef.current?.zoomBy(1 / 1.4)} title="縮小"><Minus size={17} /></button>
              <button className="icon-button" type="button" onClick={() => viewerApiRef.current?.home()} title="全体表示"><Home size={17} /></button>
            </div>
            <label className="compact-check"><input type="checkbox" checked={showAnnotations} onChange={(event) => setShowAnnotations(event.target.checked)} />OCR枠</label>
            <label className="compact-check"><input type="checkbox" checked={showCells} onChange={(event) => setShowCells(event.target.checked)} />セル</label>
            {manifest?.sourceType !== "pdf" ? (
              <label className="compact-check"><input type="checkbox" checked={showExisting} onChange={(event) => setShowExisting(event.target.checked)} />既存枠</label>
            ) : null}
            <label className="confidence-filter">
              <span>信頼度 {Math.round(confidenceThreshold * 100)}%</span>
              <input type="range" min="0" max="1" step="0.05" value={confidenceThreshold} onChange={(event) => setConfidenceThreshold(Number(event.target.value))} />
            </label>
          </div>

          <div className="viewer-stage">
            {canvas ? (
              <IiifViewer
                canvas={canvas}
                records={pageRecords}
                selectedId={selectedId}
                focusToken={focusToken}
                tool={tool}
                showAnnotations={showAnnotations}
                showCells={showCells}
                showExisting={showExisting}
                confidenceThreshold={confidenceThreshold}
                mergeMode={mergeMode}
                mergeIds={mergeIds}
                reorderMode={reorderMode}
                reorderIds={reorderIds}
                onSelect={(id) => selectAnnotation(id, false)}
                onMergePick={pickMergeAnnotation}
                onReorderPick={pickReorderAnnotation}
                onGeometryChange={updateGeometry}
                onAdd={addRecord}
                onToolChange={setTool}
                onError={reportViewerError}
                viewerApiRef={viewerApiRef}
              />
            ) : <div className="viewer-placeholder"><Layers size={34} /><span>プロジェクトを開く</span></div>}
          </div>
          <footer className="status-bar">
            <span>{message}</span>
            {warnings.length > 0 ? <span className="warning-text">{warnings.join(" / ")}</span> : null}
            {canvas ? <code>{canvas.width} × {canvas.height}</code> : null}
          </footer>
        </section>

        <aside className="ocr-column">
          <div className="right-header">
            <div className="page-counts">
              <span><strong>{counts.total}</strong> 件</span>
              <span><strong>{counts.corrected}</strong> 修正</span>
              <span><strong>{counts.unconfirmed}</strong> 未確認</span>
            </div>
            <div className="filter-row">
              <label className="search-field"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="検索" /></label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="状態フィルタ">
                <option value="all">全状態</option>
                <option value="machine">machine</option>
                <option value="verified">verified</option>
                <option value="corrected">corrected</option>
              </select>
              <select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)} aria-label="並べ替え">
                <option value="manual">手動順</option>
                <option value="reading">位置順</option>
                <option value="confidence-asc">信頼度 昇順</option>
                <option value="confidence-desc">信頼度 降順</option>
              </select>
            </div>
          </div>

          <AnnotationInspector
            record={selected}
            onTextChange={updateText}
            onStatusChange={updateStatus}
            onGeometryChange={updateGeometry}
            onDelete={deleteRecord}
          />
          <AnnotationList
            records={filteredRecords}
            selectedId={selectedId}
            mergeMode={mergeMode}
            mergeIds={mergeIds}
            reorderMode={reorderMode}
            reorderIds={reorderIds}
            onSelect={selectAnnotation}
            onMergePick={pickMergeAnnotation}
            onReorderPick={pickReorderAnnotation}
          />
        </aside>
      </main>
    </div>
  );
}
