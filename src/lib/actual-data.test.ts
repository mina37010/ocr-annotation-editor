import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import type { OcrRecord } from "../types";
import { parseManifest } from "./iiif";
import { parseTsv, requiredColumns, serializeTsv } from "./tsv";

const root = "/opt/homebrew/var/www/iiifimages/トリガーデータセットEXTEND";
const manifestPath = join(root, "manifest/scripts/manifest.json");
const legacyDirectory = join(root, "ocr_cells");

describe("supplied OCR assets", () => {
  it.skipIf(!existsSync(manifestPath) || !existsSync(legacyDirectory))("joins all available page OCR rows to Canvas IDs", async () => {
    const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
    const columns = [...requiredColumns, "source_x", "source_y", "source_w", "source_h"];
    const rows: OcrRecord[] = [];
    const files = readdirSync(legacyDirectory).filter((name) => /^page-\d+_paddle_cells\.tsv$/.test(name)).sort();
    for (const filename of files) {
      const page = Number(filename.match(/^page-(\d+)/)?.[1]);
      const canvas = manifest.canvases[page - 1];
      const parsed = Papa.parse<Record<string, string>>(readFileSync(join(legacyDirectory, filename), "utf8"), { header: true, delimiter: "\t", skipEmptyLines: true });
      parsed.data.forEach((legacy, index) => {
        const record: OcrRecord = Object.fromEntries(columns.map((column) => [column, ""]));
        const x = legacy.x || "0";
        const y = legacy.y || "0";
        const w = legacy.w || "1";
        const h = legacy.h || "1";
        Object.assign(record, {
          annotation_id: `${canvas.id}/annotations/ocr-${String(index + 1).padStart(5, "0")}`,
          canvas_id: canvas.id,
          target: `${canvas.id}#xywh=${x},${y},${w},${h}`,
          page: String(page),
          image_file: basename(filename).replace("_paddle_cells.tsv", ".jpg"),
          x, y, w, h,
          text: legacy.text ?? "",
          confidence: legacy.confidence ?? "0",
          mode: legacy.mode ?? "cell",
          row: legacy.row ?? "",
          col: legacy.col ?? "",
          cell_x: x, cell_y: y, cell_w: w, cell_h: h,
          image_width: String(canvas.width), image_height: String(canvas.height),
          canvas_width: String(canvas.width), canvas_height: String(canvas.height),
          source_x: x, source_y: y, source_w: w, source_h: h,
          status: "machine",
        });
        rows.push(record);
      });
    }
    const unified = serializeTsv(rows, columns);
    const dataset = await parseTsv(unified, "ocr_all_pages.tsv", manifest.canvases);
    expect(files).toHaveLength(42);
    expect(dataset.records.length).toBeGreaterThan(900);
    expect(new Set(dataset.records.map((record) => record.canvas_id)).size).toBe(42);
    expect(dataset.records.every((record) => record.target.startsWith(`${record.canvas_id}#xywh=`))).toBe(true);
  });
});
