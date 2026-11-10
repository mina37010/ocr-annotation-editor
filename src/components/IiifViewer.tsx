import { useEffect, useMemo, useRef, useState } from "react";
import OpenSeadragon from "openseadragon";
import type { CanvasInfo, OcrRecord, Rect } from "../types";
import { cellRect, clipRect, numberValue, recordRect } from "../lib/geometry";
import { canvasRectToViewerPixels, viewerPixelsToCanvasPoint } from "../lib/viewerCoordinates";

type ViewerTool = "select" | "add";
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type DragState = {
  kind: "move" | "resize" | "add";
  id?: string;
  handle?: ResizeHandle;
  startPoint: { x: number; y: number };
  startRect: Rect;
};

type Props = {
  canvas: CanvasInfo;
  records: OcrRecord[];
  selectedId: string | null;
  focusToken: number;
  tool: ViewerTool;
  showAnnotations: boolean;
  showCells: boolean;
  showExisting: boolean;
  confidenceThreshold: number;
  mergeMode: boolean;
  mergeIds: string[];
  reorderMode: boolean;
  reorderIds: string[];
  onSelect: (id: string) => void;
  onMergePick: (id: string) => void;
  onReorderPick: (id: string) => void;
  onGeometryChange: (id: string, rect: Rect) => void;
  onAdd: (rect: Rect) => void;
  onToolChange: (tool: ViewerTool) => void;
  onError: (message: string) => void;
  viewerApiRef: React.MutableRefObject<{
    zoomBy: (factor: number) => void;
    home: () => void;
  } | null>;
};

const handles: ResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function handlePoint(rect: Rect, handle: ResizeHandle) {
  const x = handle.includes("w") ? rect.x : handle.includes("e") ? rect.x + rect.w : rect.x + rect.w / 2;
  const y = handle.includes("n") ? rect.y : handle.includes("s") ? rect.y + rect.h : rect.y + rect.h / 2;
  return { x, y };
}

function resizedRect(start: Rect, handle: ResizeHandle, point: { x: number; y: number }): Rect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  if (handle.includes("w")) left = point.x;
  if (handle.includes("e")) right = point.x;
  if (handle.includes("n")) top = point.y;
  if (handle.includes("s")) bottom = point.y;
  if (right < left) [left, right] = [right, left];
  if (bottom < top) [top, bottom] = [bottom, top];
  return { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) };
}

export function IiifViewer({
  canvas,
  records,
  selectedId,
  focusToken,
  tool,
  showAnnotations,
  showCells,
  showExisting,
  confidenceThreshold,
  mergeMode,
  mergeIds,
  reorderMode,
  reorderIds,
  onSelect,
  onMergePick,
  onReorderPick,
  onGeometryChange,
  onAdd,
  onToolChange,
  onError,
  viewerApiRef,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const [viewportVersion, setViewportVersion] = useState(0);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [previewRect, setPreviewRect] = useState<Rect | null>(null);
  const selected = records.find((record) => record.annotation_id === selectedId) ?? null;

  useEffect(() => {
    if (!hostRef.current) return;
    const viewer = OpenSeadragon({
      element: hostRef.current,
      showNavigationControl: false,
      animationTime: 0.25,
      blendTime: 0,
      constrainDuringPan: true,
      visibilityRatio: 0.7,
      minZoomImageRatio: 0.8,
      maxZoomPixelRatio: 8,
      gestureSettingsMouse: { clickToZoom: false },
      gestureSettingsTouch: { pinchToZoom: true },
    });
    viewerRef.current = viewer;
    const redraw = () => setViewportVersion((value) => value + 1);
    viewer.addHandler("animation", redraw);
    viewer.addHandler("resize", redraw);
    viewer.addHandler("open", () => {
      redraw();
      setSourceLoading(false);
    });
    viewer.addHandler("open-failed", (event) => {
      setSourceLoading(false);
      const message = "message" in event && typeof event.message === "string" ? event.message : "画像を開けませんでした。";
      onError(`画像の読み込みに失敗しました。URLとCORS設定を確認してください。 ${message}`);
    });
    viewerApiRef.current = {
      zoomBy: (factor) => {
        viewer.viewport.zoomBy(factor);
        viewer.viewport.applyConstraints();
      },
      home: () => viewer.viewport.goHome(),
    };
    return () => {
      viewerApiRef.current = null;
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [onError, viewerApiRef]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    let cancelled = false;
    setDrag(null);
    setPreviewRect(null);
    setSourceLoading(true);
    viewer.close();
    if (canvas.imageServiceId) {
      viewer.open(`${canvas.imageServiceId}/info.json`);
    } else if (canvas.imageUrl) {
      viewer.open({ type: "image", url: canvas.imageUrl });
    } else if (canvas.sourceType === "pdf") {
      import("../lib/pdf").then(({ renderPdfCanvas }) => renderPdfCanvas(canvas)).then((url) => {
        if (!cancelled) viewer.open({ type: "image", url });
      }).catch((error) => {
        if (cancelled) return;
        setSourceLoading(false);
        onError(error instanceof Error ? error.message : String(error));
      });
    } else {
      setSourceLoading(false);
      onError("このCanvasにはpainting画像がありません。");
    }
    return () => { cancelled = true; };
  }, [canvas.id, canvas.imageServiceId, canvas.imageUrl, canvas.sourceType, canvas.pdfDocumentId, canvas.pdfPageNumber, canvas.width, canvas.height, onError]);

  useEffect(() => {
    viewerRef.current?.setMouseNavEnabled(tool === "select" && !drag && !mergeMode && !reorderMode);
  }, [tool, drag, mergeMode, reorderMode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !selected) return;
    const rect = recordRect(selected);
    const viewportBounds = viewer.viewport.viewportToImageRectangle(viewer.viewport.getBounds(true));
    const visible =
      rect.x >= viewportBounds.x &&
      rect.y >= viewportBounds.y &&
      rect.x + rect.w <= viewportBounds.x + viewportBounds.width &&
      rect.y + rect.h <= viewportBounds.y + viewportBounds.height;
    if (!visible) {
      const center = viewer.viewport.imageToViewportCoordinates(rect.x + rect.w / 2, rect.y + rect.h / 2);
      viewer.viewport.panTo(center, true);
      viewer.viewport.applyConstraints();
    }
  }, [focusToken]);

  const boxes = useMemo(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.world.getItemCount()) return [];
    return records.map((record) => {
      const baseRect = record.annotation_id === selectedId && previewRect ? previewRect : recordRect(record);
      return { record, canvasRect: baseRect, pixelRect: canvasRectToViewerPixels(viewer, baseRect) };
    });
  }, [records, selectedId, previewRect, viewportVersion]);

  const cellBoxes = useMemo(() => {
    const viewer = viewerRef.current;
    if (!viewer || !viewer.world.getItemCount() || !showCells) return [];
    const seen = new Set<string>();
    return records.flatMap((record) => {
      const rect = cellRect(record);
      if (!rect) return [];
      const key = `${rect.x}:${rect.y}:${rect.w}:${rect.h}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ key, rect: canvasRectToViewerPixels(viewer, rect) }];
    });
  }, [records, showCells, viewportVersion]);

  function eventPoint(event: React.PointerEvent<SVGElement>) {
    const viewer = viewerRef.current;
    const host = hostRef.current;
    if (!viewer || !host) return { x: 0, y: 0 };
    const bounds = host.getBoundingClientRect();
    return viewerPixelsToCanvasPoint(viewer, event.clientX - bounds.left, event.clientY - bounds.top);
  }

  function startMove(event: React.PointerEvent<SVGRectElement>, record: OcrRecord) {
    if (tool !== "select") return;
    event.preventDefault();
    event.stopPropagation();
    if (mergeMode) {
      onMergePick(record.annotation_id);
      return;
    }
    if (reorderMode) {
      onReorderPick(record.annotation_id);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(record.annotation_id);
    const rect = recordRect(record);
    setDrag({ kind: "move", id: record.annotation_id, startPoint: eventPoint(event), startRect: rect });
    setPreviewRect(rect);
  }

  function startResize(event: React.PointerEvent<SVGRectElement>, handle: ResizeHandle) {
    if (!selected) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = recordRect(selected);
    setDrag({ kind: "resize", id: selected.annotation_id, handle, startPoint: eventPoint(event), startRect: rect });
    setPreviewRect(rect);
  }

  function startAdd(event: React.PointerEvent<SVGRectElement>) {
    if (tool !== "add") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = eventPoint(event);
    const rect = { x: point.x, y: point.y, w: 1, h: 1 };
    setDrag({ kind: "add", startPoint: point, startRect: rect });
    setPreviewRect(rect);
  }

  function movePointer(event: React.PointerEvent<SVGElement>) {
    if (!drag) return;
    const point = eventPoint(event);
    let next: Rect;
    if (drag.kind === "move") {
      next = {
        ...drag.startRect,
        x: drag.startRect.x + point.x - drag.startPoint.x,
        y: drag.startRect.y + point.y - drag.startPoint.y,
      };
    } else if (drag.kind === "resize") {
      next = resizedRect(drag.startRect, drag.handle!, point);
    } else {
      next = {
        x: Math.min(drag.startPoint.x, point.x),
        y: Math.min(drag.startPoint.y, point.y),
        w: Math.abs(point.x - drag.startPoint.x),
        h: Math.abs(point.y - drag.startPoint.y),
      };
    }
    setPreviewRect(clipRect(next, canvas.width, canvas.height));
  }

  function endPointer() {
    if (!drag || !previewRect) return;
    if (drag.kind === "add") {
      if (previewRect.w >= 2 && previewRect.h >= 2) onAdd(previewRect);
      onToolChange("select");
    } else if (drag.id) {
      onGeometryChange(drag.id, previewRect);
    }
    setDrag(null);
    setPreviewRect(null);
  }

  const selectedPixelRect = boxes.find((box) => box.record.annotation_id === selectedId)?.pixelRect ?? null;

  return (
    <div className="viewer-shell">
      <div ref={hostRef} className="osd-host" aria-label={`${canvas.label} ${canvas.sourceType === "pdf" ? "PDFページ" : "IIIF画像"}`} />
      {sourceLoading ? <div className="viewer-loading">読み込み中</div> : null}
      <svg
        className="annotation-overlay"
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={() => { setDrag(null); setPreviewRect(null); }}
      >
        {showExisting && canvas.existingRegions.map((region) => {
          const viewer = viewerRef.current;
          if (!viewer || !viewer.world.getItemCount()) return null;
          const rect = canvasRectToViewerPixels(viewer, region);
          return <rect key={region.id} className="existing-region" x={rect.x} y={rect.y} width={rect.w} height={rect.h}><title>{region.label}</title></rect>;
        })}
        {cellBoxes.map(({ key, rect }) => (
          <rect key={key} className="cell-region" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
        ))}
        {showAnnotations && boxes.map(({ record, pixelRect }) => {
          const confidence = numberValue(record.confidence, 1);
          if (confidence < confidenceThreshold) return null;
          const selectedBox = record.annotation_id === selectedId;
          const sequenceIndex = mergeMode ? mergeIds.indexOf(record.annotation_id) : reorderMode ? reorderIds.indexOf(record.annotation_id) : -1;
          return (
            <g key={record.annotation_id}>
              <rect
                className={`ocr-region status-${record.status || "machine"}${confidence < 0.5 ? " low-confidence" : ""}${selectedBox ? " selected" : ""}${sequenceIndex >= 0 ? mergeMode ? " merge-selected" : " reorder-selected" : ""}${mergeMode || reorderMode ? " sequence-mode" : ""}`}
                x={pixelRect.x}
                y={pixelRect.y}
                width={pixelRect.w}
                height={pixelRect.h}
                onPointerDown={(event) => startMove(event, record)}
              >
                <title>{record.text || "(空欄)"}</title>
              </rect>
              {sequenceIndex >= 0 ? (
                <g className={`sequence-order ${mergeMode ? "merge" : "reorder"}`} pointerEvents="none">
                  <circle cx={pixelRect.x + 10} cy={pixelRect.y + 10} r="9" />
                  <text x={pixelRect.x + 10} y={pixelRect.y + 13}>{sequenceIndex + 1}</text>
                </g>
              ) : null}
            </g>
          );
        })}
        {tool === "add" ? (
          <rect className="add-capture" x="0" y="0" width="100%" height="100%" onPointerDown={startAdd} />
        ) : null}
        {drag?.kind === "add" && previewRect && viewerRef.current && viewerRef.current.world.getItemCount() ? (() => {
          const rect = canvasRectToViewerPixels(viewerRef.current!, previewRect);
          return <rect className="new-region" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />;
        })() : null}
        {tool === "select" && !mergeMode && !reorderMode && selectedPixelRect ? handles.map((handle) => {
          const point = handlePoint(selectedPixelRect, handle);
          return (
            <rect
              key={handle}
              className={`resize-handle handle-${handle}`}
              x={point.x - 4}
              y={point.y - 4}
              width="8"
              height="8"
              onPointerDown={(event) => startResize(event, handle)}
            />
          );
        }) : null}
      </svg>
    </div>
  );
}
