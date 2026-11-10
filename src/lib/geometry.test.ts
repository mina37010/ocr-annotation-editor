import { describe, expect, it } from "vitest";
import { clipRect, synchronizeGeometry } from "./geometry";
import type { OcrRecord } from "../types";

describe("geometry", () => {
  it("clips an edited region to the Canvas", () => {
    expect(clipRect({ x: -20, y: 90, w: 180, h: 40 }, 100, 100)).toEqual({ x: 0, y: 90, w: 100, h: 10 });
  });

  it("synchronizes xywh target and source-image coordinates", () => {
    const record: OcrRecord = {
      annotation_id: "ann-1",
      canvas_id: "https://example.test/canvas/1",
      target: "",
      x: "0", y: "0", w: "1", h: "1",
      canvas_width: "2000", canvas_height: "1000",
      image_width: "4000", image_height: "2000",
      source_x: "", source_y: "", source_w: "", source_h: "",
      status: "machine",
    };
    const result = synchronizeGeometry(record, { x: 10, y: 20, w: 30, h: 40 });
    expect(result.target).toBe("https://example.test/canvas/1#xywh=10,20,30,40");
    expect([result.source_x, result.source_y, result.source_w, result.source_h]).toEqual(["20", "40", "60", "80"]);
    expect(result.status).toBe("corrected");
  });
});
