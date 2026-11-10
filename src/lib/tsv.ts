import Papa from "papaparse";
import type { CanvasInfo, OcrDataset, OcrRecord } from "../types";

export const requiredColumns = [
  "annotation_id", "canvas_id", "target", "page", "image_file", "x", "y", "w", "h", "text",
  "confidence", "mode", "row", "col", "cell_x", "cell_y", "cell_w", "cell_h", "image_width",
  "image_height", "canvas_width", "canvas_height", "status",
];

export const emptyDatasetColumns = [
  ...requiredColumns.slice(0, -1),
  "source_x", "source_y", "source_w", "source_h",
  "status",
];

function normalizedText(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  return sha256Bytes(bytes);
}

export async function sha256Bytes(value: BufferSource) {
  const hash = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type TsvPageInfo = {
  page: number;
  canvasId: string;
  width: number | null;
  height: number | null;
};

export function inspectTsvPages(text: string): TsvPageInfo[] {
  const parsed = Papa.parse<OcrRecord>(normalizedText(text), {
    header: true,
    delimiter: "\t",
    skipEmptyLines: "greedy",
  });
  if (parsed.errors.length > 0) throw new Error(`TSVを解析できませんでした: ${parsed.errors[0].message}`);
  const byPage = new Map<number, TsvPageInfo>();
  const canvasPages = new Map<string, number>();
  for (const row of parsed.data) {
    const page = Number.parseInt(row.page, 10);
    if (!Number.isInteger(page) || page < 1 || !row.canvas_id) continue;
    const width = Number(row.canvas_width);
    const height = Number(row.canvas_height);
    const previous = byPage.get(page);
    if (previous && previous.canvasId !== row.canvas_id) {
      throw new Error(`TSVの${page}ページに複数のcanvas_idがあります。`);
    }
    const previousPage = canvasPages.get(row.canvas_id);
    if (previousPage && previousPage !== page) {
      throw new Error(`TSVのcanvas_idが複数ページに使われています: ${row.canvas_id}`);
    }
    canvasPages.set(row.canvas_id, page);
    byPage.set(page, {
      page,
      canvasId: row.canvas_id,
      width: Number.isFinite(width) && width > 0 ? width : previous?.width ?? null,
      height: Number.isFinite(height) && height > 0 ? height : previous?.height ?? null,
    });
  }
  return Array.from(byPage.values()).sort((a, b) => a.page - b.page);
}

export async function parseTsv(text: string, sourceName: string, canvases: CanvasInfo[]): Promise<OcrDataset> {
  const source = normalizedText(text);
  const parsed = Papa.parse<OcrRecord>(source, {
    header: true,
    delimiter: "\t",
    skipEmptyLines: "greedy",
  });
  const columns = parsed.meta.fields ?? [];
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`TSV ${first.row !== undefined ? `${first.row + 1}行目 ` : ""}${first.message}`);
  }
  const missing = requiredColumns.filter((column) => !columns.includes(column));
  if (missing.length > 0) throw new Error(`TSVに必須列がありません: ${missing.join(", ")}`);

  const records = parsed.data.map((row) => {
    const normalized: OcrRecord = {};
    for (const column of columns) normalized[column] = row[column] ?? "";
    normalized.status = normalized.status || "machine";
    return normalized;
  });
  const warnings: string[] = [];
  const canvasIds = new Set(canvases.map((canvas) => canvas.id));
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  const unknownCanvases = new Set<string>();
  for (const row of records) {
    if (ids.has(row.annotation_id)) duplicates.add(row.annotation_id);
    ids.add(row.annotation_id);
    if (!canvasIds.has(row.canvas_id)) unknownCanvases.add(row.canvas_id);
  }
  if (duplicates.size > 0) throw new Error(`annotation_idが重複しています: ${Array.from(duplicates).slice(0, 5).join(", ")}`);
  if (unknownCanvases.size > 0) warnings.push(`入力元にないCanvas ID: ${unknownCanvases.size}件`);
  const canvasWithoutOcr = canvases.filter((canvas) => !records.some((row) => row.canvas_id === canvas.id));
  if (canvasWithoutOcr.length > 0) warnings.push(`OCRのないCanvas: ${canvasWithoutOcr.length}件`);
  return {
    columns,
    records,
    sourceName,
    fingerprint: await sha256(source),
    warnings,
  };
}

export async function createEmptyDataset(sourceName = "ocr_all_pages.tsv"): Promise<OcrDataset> {
  return {
    columns: [...emptyDatasetColumns],
    records: [],
    sourceName,
    fingerprint: await sha256("ocr-annotation-editor:empty-dataset:v1"),
    warnings: [],
  };
}

export function serializeTsv(records: OcrRecord[], columns: string[]) {
  const data = records.length > 0 ? records : { fields: columns, data: [] as OcrRecord[] };
  return `\uFEFF${Papa.unparse(data, {
    columns,
    delimiter: "\t",
    newline: "\r\n",
    quotes: false,
    escapeFormulae: false,
  })}\r\n`;
}

export function correctedFilename(sourceName: string) {
  const stem = sourceName.replace(/\.tsv$/i, "") || "ocr_all_pages";
  return /_corrected$/i.test(stem) ? `${stem}_2.tsv` : `${stem}_corrected.tsv`;
}
