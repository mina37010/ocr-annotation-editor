export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ExistingRegion = Rect & {
  id: string;
  label: string;
  motivation: string;
};

export type CanvasInfo = {
  id: string;
  label: string;
  width: number;
  height: number;
  sourceType: "iiif" | "pdf";
  imageServiceId: string | null;
  imageUrl: string | null;
  pdfDocumentId: string | null;
  pdfPageNumber: number | null;
  existingRegions: ExistingRegion[];
};

export type ParsedManifest = {
  id: string;
  label: string;
  sourceType: "iiif" | "pdf";
  canvases: CanvasInfo[];
  source: unknown;
};

export type OcrRecord = Record<string, string>;

export type OcrDataset = {
  columns: string[];
  records: OcrRecord[];
  sourceName: string;
  fingerprint: string;
  warnings: string[];
};

export type AnnotationStatus = "machine" | "verified" | "corrected";

export type EditorSnapshot = {
  records: OcrRecord[];
};

export type SavedProject = {
  version: 1;
  projectKey: string;
  manifestId: string;
  tsvFingerprint: string;
  columns: string[];
  records: OcrRecord[];
  sourceName: string;
  canvasIndex: number;
  selectedId: string | null;
  dirty: boolean;
  savedAt: number;
};
