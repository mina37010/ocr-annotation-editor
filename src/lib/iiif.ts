import type { CanvasInfo, ExistingRegion, ParsedManifest } from "../types";
import { parseXywhTarget } from "./geometry";

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function localizedLabel(value: unknown, fallback: string) {
  if (typeof value === "string") return value;
  const label = objectValue(value);
  if (!label) return fallback;
  for (const key of ["ja", "none", "en", ...Object.keys(label)]) {
    const candidate = label[key];
    if (Array.isArray(candidate) && typeof candidate[0] === "string") return candidate[0];
  }
  return fallback;
}

function bodyLabel(body: unknown) {
  const object = objectValue(body);
  if (!object) return "既存Annotation";
  if (typeof object.value === "string") return object.value;
  return localizedLabel(object.label, "既存Annotation");
}

function annotationRegions(canvas: JsonObject): ExistingRegion[] {
  const pages = [
    ...arrayValue(canvas.annotations),
    ...arrayValue(canvas.items),
  ];
  const regions: ExistingRegion[] = [];
  for (const pageValue of pages) {
    const page = objectValue(pageValue);
    for (const annotationValue of arrayValue(page?.items)) {
      const annotation = objectValue(annotationValue);
      if (!annotation || annotation.motivation === "painting") continue;
      const target = objectValue(annotation.target);
      const selector = objectValue(target?.selector);
      const rect = parseXywhTarget(annotation.target) ?? parseXywhTarget(selector?.value);
      if (!rect) continue;
      regions.push({
        ...rect,
        id: String(annotation.id ?? `existing-${regions.length + 1}`),
        motivation: String(annotation.motivation ?? "unknown"),
        label: bodyLabel(annotation.body),
      });
    }
  }
  return regions;
}

function paintingSource(canvas: JsonObject) {
  for (const pageValue of arrayValue(canvas.items)) {
    const page = objectValue(pageValue);
    for (const annotationValue of arrayValue(page?.items)) {
      const annotation = objectValue(annotationValue);
      if (!annotation || annotation.motivation !== "painting") continue;
      const body = objectValue(annotation.body);
      if (!body) continue;
      const services = Array.isArray(body.service) ? body.service : body.service ? [body.service] : [];
      const service = services.map(objectValue).find((item) => item && typeof item.id === "string");
      return {
        imageServiceId: service ? String(service.id).replace(/\/$/, "") : null,
        imageUrl: typeof body.id === "string" ? body.id : null,
      };
    }
  }
  return { imageServiceId: null, imageUrl: null };
}

export function parseManifest(input: unknown): ParsedManifest {
  const manifest = objectValue(input);
  if (!manifest || manifest.type !== "Manifest" || typeof manifest.id !== "string") {
    throw new Error("IIIF Presentation API 3.0 Manifestではありません。");
  }
  const items = arrayValue(manifest.items);
  if (items.length === 0) throw new Error("ManifestにCanvasがありません。");
  const ids = new Set<string>();
  const canvases: CanvasInfo[] = items.map((value, index) => {
    const canvas = objectValue(value);
    const id = typeof canvas?.id === "string" ? canvas.id : "";
    const width = Number(canvas?.width);
    const height = Number(canvas?.height);
    if (!id || canvas?.type !== "Canvas" || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error(`${index + 1}番目のCanvasにidまたは寸法がありません。`);
    }
    if (ids.has(id)) throw new Error(`Canvas IDが重複しています: ${id}`);
    ids.add(id);
    const source = paintingSource(canvas);
    return {
      id,
      label: localizedLabel(canvas.label, `${index + 1}ページ`),
      width,
      height,
      sourceType: "iiif",
      ...source,
      pdfDocumentId: null,
      pdfPageNumber: null,
      existingRegions: annotationRegions(canvas),
    };
  });
  return {
    id: manifest.id,
    label: localizedLabel(manifest.label, "IIIF Manifest"),
    sourceType: "iiif",
    canvases,
    source: input,
  };
}
