import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseManifest } from "./iiif";

const actualManifestPath = "/opt/homebrew/var/www/iiifimages/トリガーデータセットEXTEND/manifest/scripts/manifest.json";

describe("IIIF Manifest parser", () => {
  it.skipIf(!existsSync(actualManifestPath))("parses the supplied 42-page Manifest", () => {
    const parsed = parseManifest(JSON.parse(readFileSync(actualManifestPath, "utf8")));
    expect(parsed.canvases).toHaveLength(42);
    expect(parsed.canvases.every((canvas) => canvas.id && canvas.imageServiceId)).toBe(true);
    expect(parsed.canvases[0]).toMatchObject({ width: 1433, height: 2024 });
    expect(parsed.canvases[41].id).toContain("/canvas/p42");
  });

  it("rejects duplicate Canvas IDs", () => {
    const canvas = { id: "https://example.test/canvas/1", type: "Canvas", width: 100, height: 100, items: [] };
    expect(() => parseManifest({ id: "https://example.test/manifest", type: "Manifest", items: [canvas, canvas] })).toThrow("重複");
  });
});
