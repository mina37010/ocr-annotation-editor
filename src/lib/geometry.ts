import type { OcrRecord, Rect } from "../types";

export function numberValue(value: string | undefined, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function recordRect(record: OcrRecord): Rect {
  return {
    x: numberValue(record.x),
    y: numberValue(record.y),
    w: Math.max(1, numberValue(record.w, 1)),
    h: Math.max(1, numberValue(record.h, 1)),
  };
}

export function cellRect(record: OcrRecord): Rect | null {
  const w = numberValue(record.cell_w);
  const h = numberValue(record.cell_h);
  if (w <= 0 || h <= 0) return null;
  return {
    x: numberValue(record.cell_x),
    y: numberValue(record.cell_y),
    w,
    h,
  };
}

export function clipRect(rect: Rect, canvasWidth: number, canvasHeight: number): Rect {
  const width = Math.max(1, canvasWidth);
  const height = Math.max(1, canvasHeight);
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y)));
  const w = Math.max(1, Math.min(width - x, Math.round(rect.w)));
  const h = Math.max(1, Math.min(height - y, Math.round(rect.h)));
  return { x, y, w, h };
}

export function canvasRectToSource(rect: Rect, record: OcrRecord): Rect {
  const canvasWidth = Math.max(1, numberValue(record.canvas_width));
  const canvasHeight = Math.max(1, numberValue(record.canvas_height));
  const imageWidth = Math.max(1, numberValue(record.image_width, canvasWidth));
  const imageHeight = Math.max(1, numberValue(record.image_height, canvasHeight));
  return {
    x: Math.round((rect.x * imageWidth) / canvasWidth),
    y: Math.round((rect.y * imageHeight) / canvasHeight),
    w: Math.max(1, Math.round((rect.w * imageWidth) / canvasWidth)),
    h: Math.max(1, Math.round((rect.h * imageHeight) / canvasHeight)),
  };
}

export function synchronizeGeometry(record: OcrRecord, nextRect: Rect): OcrRecord {
  const canvasWidth = Math.max(1, numberValue(record.canvas_width));
  const canvasHeight = Math.max(1, numberValue(record.canvas_height));
  const rect = clipRect(nextRect, canvasWidth, canvasHeight);
  const next = {
    ...record,
    x: String(rect.x),
    y: String(rect.y),
    w: String(rect.w),
    h: String(rect.h),
    target: `${record.canvas_id}#xywh=${rect.x},${rect.y},${rect.w},${rect.h}`,
    status: record.status === "machine" ? "corrected" : record.status,
  };
  const sourceRect = canvasRectToSource(rect, next);
  if ("source_x" in next) next.source_x = String(sourceRect.x);
  if ("source_y" in next) next.source_y = String(sourceRect.y);
  if ("source_w" in next) next.source_w = String(sourceRect.w);
  if ("source_h" in next) next.source_h = String(sourceRect.h);
  return next;
}

export function normalizeGeometryForExport(record: OcrRecord): OcrRecord {
  const status = record.status;
  return { ...synchronizeGeometry(record, recordRect(record)), status };
}

export function parseXywhTarget(target: unknown): Rect | null {
  if (typeof target !== "string") return null;
  const match = /#xywh=(?:pixel:)?(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)/.exec(target);
  if (!match) return null;
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    w: Number(match[3]),
    h: Number(match[4]),
  };
}
