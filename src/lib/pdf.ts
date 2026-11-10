import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { CanvasInfo, ParsedManifest } from "../types";
import { inspectTsvPages, sha256Bytes } from "./tsv";

GlobalWorkerOptions.workerSrc = workerUrl;

const documents = new Map<string, PDFDocumentProxy>();
const imageCache = new Map<string, string>();
const maxCachedPages = 3;

function trimExtension(name: string) {
  return name.replace(/\.pdf$/i, "") || "PDF";
}

function rememberImage(key: string, url: string) {
  imageCache.set(key, url);
  while (imageCache.size > maxCachedPages) {
    const oldest = imageCache.entries().next().value as [string, string] | undefined;
    if (!oldest) break;
    URL.revokeObjectURL(oldest[1]);
    imageCache.delete(oldest[0]);
  }
}

export async function parsePdf(data: ArrayBuffer, sourceName: string, tsvText: string): Promise<ParsedManifest> {
  const fingerprint = await sha256Bytes(data);
  const id = `urn:pdf:${fingerprint}`;
  let document: PDFDocumentProxy;
  try {
    document = await getDocument({ data: new Uint8Array(data) }).promise;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`PDFを解析できませんでした。${detail}`);
  }
  documents.set(id, document);
  const pageInfo = new Map((tsvText.trim() ? inspectTsvPages(tsvText) : []).map((item) => [item.page, item]));
  const canvases: CanvasInfo[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const info = pageInfo.get(pageNumber);
    const width = info?.width ?? (info?.height ? info.height * viewport.width / viewport.height : Math.max(1, Math.round(viewport.width * 2)));
    const height = info?.height ?? (info?.width ? info.width * viewport.height / viewport.width : Math.max(1, Math.round(viewport.height * 2)));
    canvases.push({
      id: info?.canvasId ?? `${id}/page/${pageNumber}`,
      label: `${pageNumber}ページ`,
      width,
      height,
      sourceType: "pdf",
      imageServiceId: null,
      imageUrl: null,
      pdfDocumentId: id,
      pdfPageNumber: pageNumber,
      existingRegions: [],
    });
    page.cleanup();
  }
  return {
    id,
    label: trimExtension(sourceName),
    sourceType: "pdf",
    canvases,
    source: { name: sourceName, fingerprint },
  };
}

export async function renderPdfCanvas(canvasInfo: CanvasInfo) {
  if (!canvasInfo.pdfDocumentId || !canvasInfo.pdfPageNumber) throw new Error("PDFページ情報がありません。");
  const key = `${canvasInfo.pdfDocumentId}:${canvasInfo.pdfPageNumber}:${canvasInfo.width}x${canvasInfo.height}`;
  const cached = imageCache.get(key);
  if (cached) {
    imageCache.delete(key);
    imageCache.set(key, cached);
    return cached;
  }
  const document = documents.get(canvasInfo.pdfDocumentId);
  if (!document) throw new Error("PDFがメモリから解放されています。プロジェクトを開き直してください。");
  const page = await document.getPage(canvasInfo.pdfPageNumber);
  const viewport = page.getViewport({ scale: 1 });
  const output = window.document.createElement("canvas");
  output.width = Math.max(1, Math.round(canvasInfo.width));
  output.height = Math.max(1, Math.round(canvasInfo.height));
  const context = output.getContext("2d", { alpha: false });
  if (!context) throw new Error("PDF描画用Canvasを作成できませんでした。");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, output.width, output.height);
  await page.render({
    canvasContext: context,
    viewport,
    transform: [output.width / viewport.width, 0, 0, output.height / viewport.height, 0, 0],
  }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => {
    output.toBlob((value) => value ? resolve(value) : reject(new Error("PDFページを画像化できませんでした。")), "image/png");
  });
  page.cleanup();
  const url = URL.createObjectURL(blob);
  rememberImage(key, url);
  return url;
}
