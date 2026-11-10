import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const canvasId = "http://127.0.0.1:5174/iiif/canvas/p1";
const manifest = JSON.stringify({
  "@context": "http://iiif.io/api/presentation/3/context.json",
  id: "http://127.0.0.1:5174/iiif/manifest",
  type: "Manifest",
  label: { ja: ["E2E台本"] },
  items: [{
    id: canvasId,
    type: "Canvas",
    label: { ja: ["1ページ"] },
    width: 1000,
    height: 1400,
    items: [{
      id: "http://127.0.0.1:5174/iiif/page/p1",
      type: "AnnotationPage",
      items: [{
        id: "http://127.0.0.1:5174/iiif/painting/p1",
        type: "Annotation",
        motivation: "painting",
        body: { id: "http://127.0.0.1:5174/test-page.svg", type: "Image", format: "image/svg+xml", width: 1000, height: 1400 },
        target: canvasId,
      }],
    }],
  }],
});

const columns = [
  "annotation_id", "canvas_id", "target", "page", "image_file", "x", "y", "w", "h", "text", "confidence", "mode",
  "row", "col", "cell_x", "cell_y", "cell_w", "cell_h", "image_width", "image_height", "canvas_width", "canvas_height",
  "source_x", "source_y", "source_w", "source_h", "status", "custom_note",
];

function row(id: string, text: string, y: number, confidence: number) {
  return [id, canvasId, `${canvasId}#xywh=300,${y},250,70`, "1", "test-page.svg", "300", String(y), "250", "70", text, String(confidence), "cell", "1", "1", "280", String(y - 20), "300", "110", "1000", "1400", "1000", "1400", "300", String(y), "250", "70", "machine", "keep-me"];
}

const tsv = [columns, row(`${canvasId}/annotations/ocr-00001`, "テスト1", 270, 0.91), row(`${canvasId}/annotations/ocr-00002`, "テスト2", 450, 0.42)]
  .map((values) => values.join("\t"))
  .join("\r\n");

function blankPdf(width: number, height: number) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << >> /Contents 4 0 R >>`,
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

test("loads files, synchronizes selection, edits, undoes and exports TSV", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[accept*=".json"]').setInputFiles({ name: "manifest.json", mimeType: "application/json", buffer: Buffer.from(manifest) });
  await page.locator('input[accept*=".tsv"]').setInputFiles({ name: "ocr_all_pages.tsv", mimeType: "text/tab-separated-values", buffer: Buffer.from(tsv) });
  await page.getByRole("button", { name: "プロジェクトを開く" }).click();

  await expect(page.getByText("E2E台本", { exact: true })).toBeVisible();
  await expect(page.locator(".annotation-row")).toHaveCount(2);
  await expect(page.locator(".ocr-region")).toHaveCount(2);

  await page.getByTitle("拡大").click();
  await page.waitForTimeout(400);
  const widthBeforeSelection = (await page.locator(".ocr-region").first().boundingBox())!.width;
  await page.locator(".annotation-row").nth(1).click();
  await page.waitForTimeout(100);
  const widthAfterSelection = (await page.locator(".ocr-region").first().boundingBox())!.width;
  expect(Math.abs(widthAfterSelection - widthBeforeSelection)).toBeLessThan(1);

  await page.locator(".ocr-region").first().click();
  await expect(page.locator(".annotation-row").first()).toHaveClass(/selected/);
  await expect(page.locator(".inspector textarea")).toHaveValue("テスト1");

  await page.locator(".inspector textarea").fill("修正済みテキスト");
  await page.locator(".inspector textarea").blur();
  await expect(page.locator(".inspector select")).toHaveValue("corrected");

  await page.getByTitle("元に戻す").click();
  await expect(page.locator(".inspector textarea")).toHaveValue("テスト1");
  await page.getByTitle("やり直す").click();
  await expect(page.locator(".inspector textarea")).toHaveValue("修正済みテキスト");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "TSVを書き出す" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("ocr_all_pages_corrected.tsv");
  const path = await download.path();
  expect(path).not.toBeNull();
  const output = await readFile(path!, "utf8");
  expect(output).toContain("修正済みテキスト");
  expect(output).toContain("keep-me");
  expect(output).toContain(`${canvasId}#xywh=300,270,250,70`);

  const widthBeforeReorderShortcut = (await page.locator(".ocr-region").first().boundingBox())!.width;
  const heightBeforeReorderShortcut = (await page.locator(".ocr-region").first().boundingBox())!.height;
  await page.keyboard.press("r");
  await page.waitForTimeout(100);
  const boxAfterReorderShortcut = (await page.locator(".ocr-region").first().boundingBox())!;
  expect(Math.abs(boxAfterReorderShortcut.width - widthBeforeReorderShortcut)).toBeLessThan(1);
  expect(Math.abs(boxAfterReorderShortcut.height - heightBeforeReorderShortcut)).toBeLessThan(1);
  await expect(page.getByRole("button", { name: "適用", exact: true })).toBeVisible();
  await page.locator(".annotation-row").nth(1).click();
  await page.locator(".annotation-row").nth(0).click();
  await expect(page.locator(".sequence-list-order.reorder")).toHaveText(["2", "1"]);
  await page.screenshot({ path: "test-results/editor.png" });
  await page.getByRole("button", { name: "適用", exact: true }).click();
  await expect(page.locator(".annotation-row-main strong")).toHaveText(["テスト2", "修正済みテキスト"]);

  const reorderedDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "TSVを書き出す" }).click();
  const reorderedPath = await (await reorderedDownloadPromise).path();
  const reorderedOutput = await readFile(reorderedPath!, "utf8");
  expect(reorderedOutput.indexOf("ocr-00002")).toBeLessThan(reorderedOutput.indexOf("ocr-00001"));
  await page.getByTitle("元に戻す").click();
  await expect(page.locator(".annotation-row-main strong")).toHaveText(["修正済みテキスト", "テスト2"]);

  await page.keyboard.press("m");
  await expect(page.getByRole("button", { name: "結合", exact: true })).toBeVisible();
  await page.locator(".annotation-row").nth(1).click();
  await page.locator(".annotation-row").nth(0).click();
  await expect(page.locator(".sequence-list-order.merge")).toHaveText(["2", "1"]);
  await page.getByRole("button", { name: "結合", exact: true }).click();
  await expect(page.locator(".annotation-row")).toHaveCount(1);
  await expect(page.locator(".inspector textarea")).toHaveValue("テスト2修正済みテキスト");
  await page.getByTitle("元に戻す").click();
  await expect(page.locator(".annotation-row")).toHaveCount(2);
});

test("loads a PDF beside the existing Manifest mode", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await page.locator('input[accept*=".pdf"]').setInputFiles({
    name: "test-page.pdf",
    mimeType: "application/pdf",
    buffer: blankPdf(1000, 1400),
  });
  await page.locator('input[accept*=".tsv"]').setInputFiles({
    name: "ocr_all_pages.tsv",
    mimeType: "text/tab-separated-values",
    buffer: Buffer.from(tsv),
  });
  await page.getByRole("button", { name: "プロジェクトを開く" }).click();

  await expect(page.getByText("test-page", { exact: true })).toBeVisible();
  await expect(page.locator(".annotation-row")).toHaveCount(2);
  await expect(page.locator(".ocr-region")).toHaveCount(2);
  await expect(page.locator(".osd-host canvas")).toBeVisible();
  await expect(page.getByText("PDF 1ページ / 2件を読み込みました。", { exact: true })).toBeVisible();
});
