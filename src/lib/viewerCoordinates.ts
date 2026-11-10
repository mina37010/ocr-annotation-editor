import OpenSeadragon from "openseadragon";
import type { Rect } from "../types";

export function canvasPointToViewerPixels(viewer: OpenSeadragon.Viewer, x: number, y: number) {
  const point = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(x, y));
  return { x: point.x, y: point.y };
}

export function viewerPixelsToCanvasPoint(viewer: OpenSeadragon.Viewer, x: number, y: number) {
  const point = viewer.viewport.viewerElementToImageCoordinates(new OpenSeadragon.Point(x, y));
  return { x: point.x, y: point.y };
}

export function canvasRectToViewerPixels(viewer: OpenSeadragon.Viewer, rect: Rect): Rect {
  const start = canvasPointToViewerPixels(viewer, rect.x, rect.y);
  const end = canvasPointToViewerPixels(viewer, rect.x + rect.w, rect.y + rect.h);
  return { x: start.x, y: start.y, w: end.x - start.x, h: end.y - start.y };
}
