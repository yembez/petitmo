import { PDFDocument } from 'pdf-lib';
import { htmlToPdfBuffer } from './renderPdf';
import type { GelatoCoverLayout } from '../gelato/coverDimensions';

const PT_TO_MM = 0.352778;

export async function mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf);
    const copied = await merged.copyPages(src, src.getPageIndices());
    for (const page of copied) {
      merged.addPage(page);
    }
  }
  return Buffer.from(await merged.save());
}

/** Rend spread + bloc intérieur en 2 passes Playwright (formats @page distincts). */
export async function renderGelatoPhotobookPdf(
  spreadHtml: string,
  blockHtml: string,
  layout: GelatoCoverLayout,
): Promise<Buffer> {
  const [spreadBuf, blockBuf] = await Promise.all([
    htmlToPdfBuffer(spreadHtml),
    htmlToPdfBuffer(blockHtml),
  ]);
  const merged = await mergePdfBuffers([spreadBuf, blockBuf]);

  const doc = await PDFDocument.load(merged);
  const spreadPage = doc.getPage(0);
  const wMm = spreadPage.getWidth() * PT_TO_MM;
  const hMm = spreadPage.getHeight() * PT_TO_MM;
  const tol = 2;
  if (
    Math.abs(wMm - layout.spreadWidthMm) > tol ||
    Math.abs(hMm - layout.spreadHeightMm) > tol
  ) {
    throw new Error(
      `Gelato spread PDF ${wMm.toFixed(1)}×${hMm.toFixed(1)} mm, attendu ${layout.spreadWidthMm}×${layout.spreadHeightMm} mm`,
    );
  }

  return merged;
}
