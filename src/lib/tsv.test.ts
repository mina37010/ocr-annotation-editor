import { describe, expect, it } from "vitest";
import type { CanvasInfo } from "../types";
import { inspectTsvPages, parseTsv, requiredColumns, serializeTsv } from "./tsv";

const canvas: CanvasInfo = {
  id: "https://example.test/canvas/p1",
  label: "1ページ",
  width: 1000,
  height: 1400,
  sourceType: "iiif",
  imageServiceId: "https://example.test/iiif/page-001",
  imageUrl: null,
  pdfDocumentId: null,
  pdfPageNumber: null,
  existingRegions: [],
};

function sourceTsv(id = "ann-1") {
  const columns = [...requiredColumns, "source_x", "source_y", "source_w", "source_h", "custom_note"];
  const values: Record<string, string> = Object.fromEntries(columns.map((column) => [column, ""]));
  Object.assign(values, {
    annotation_id: id,
    canvas_id: canvas.id,
    target: `${canvas.id}#xywh=10,20,30,40`,
    page: "1",
    image_file: "page-001.jpg",
    x: "10", y: "20", w: "30", h: "40",
    text: "引用符 \"あり\"\n改行と\tタブ",
    confidence: "0.8123",
    mode: "cell",
    row: "1", col: "2",
    cell_x: "0", cell_y: "0", cell_w: "100", cell_h: "80",
    image_width: "1000", image_height: "1400",
    canvas_width: "1000", canvas_height: "1400",
    source_x: "10", source_y: "20", source_w: "30", source_h: "40",
    status: "machine",
    custom_note: "未知列を保持",
  });
  return serializeTsv([values], columns);
}

describe("TSV round trip", () => {
  it("preserves multiline text, IDs, coordinates and unknown columns", async () => {
    const first = await parseTsv(sourceTsv(), "ocr_all_pages.tsv", [canvas]);
    const exported = serializeTsv(first.records, first.columns);
    const second = await parseTsv(exported, "ocr_all_pages_corrected.tsv", [canvas]);
    expect(second.columns).toEqual(first.columns);
    expect(second.records).toEqual(first.records);
    expect(second.records[0].text).toBe("引用符 \"あり\"\n改行と\tタブ");
    expect(second.records[0].custom_note).toBe("未知列を保持");
  });

  it("rejects duplicate annotation IDs", async () => {
    const first = await parseTsv(sourceTsv(), "first.tsv", [canvas]);
    const duplicate = serializeTsv([first.records[0], { ...first.records[0] }], first.columns);
    await expect(parseTsv(duplicate, "duplicate.tsv", [canvas])).rejects.toThrow("重複");
  });

  it("maps PDF pages to existing canvas IDs and dimensions", () => {
    expect(inspectTsvPages(sourceTsv())).toEqual([{
      page: 1,
      canvasId: canvas.id,
      width: 1000,
      height: 1400,
    }]);
  });

  it("rejects multiple canvas IDs on the same PDF page", async () => {
    const first = await parseTsv(sourceTsv(), "first.tsv", [canvas]);
    const conflict = {
      ...first.records[0],
      annotation_id: "ann-2",
      canvas_id: "https://example.test/canvas/other",
    };
    const source = serializeTsv([first.records[0], conflict], first.columns);
    expect(() => inspectTsvPages(source)).toThrow("複数のcanvas_id");
  });
});
