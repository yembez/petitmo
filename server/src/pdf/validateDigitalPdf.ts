import { PDFDocument } from 'pdf-lib';
import { DIGITAL_PAGE_HEIGHT_MM, DIGITAL_PAGE_WIDTH_MM } from '../constants/pdfDigitalSpec';

const MM_TO_PT = 72 / 25.4;
const EXPECT_W_PT = DIGITAL_PAGE_WIDTH_MM * MM_TO_PT;
const EXPECT_H_PT = DIGITAL_PAGE_HEIGHT_MM * MM_TO_PT;
/** Tolérance (pt) : arrondis moteur PDF / Chromium. */
const SIZE_TOL_PT = 2;

export type DigitalPdfValidationResult = { ok: true } | { ok: false; message: string };

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= SIZE_TOL_PT;
}

/**
 * Contrôles post-génération pour le mode **digital** (A5 148×210 mm, portrait) :
 * — nombre de pages = attendu (détecte une page blanche « en trop » ou une page manquante) ;
 * — chaque page en portrait A5 (évite liseré / format par défaut si `@page` ignoré).
 */
export async function validateDigitalPdfBytes(
  pdfBytes: Buffer,
  expectedPageCount: number
): Promise<DigitalPdfValidationResult> {
  if (expectedPageCount < 1) {
    return { ok: false, message: 'expectedPageCount must be at least 1 for digital PDF validation' };
  }

  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'invalid PDF';
    return { ok: false, message: `PDF parse failed: ${msg}` };
  }

  const pages = doc.getPages();
  if (pages.length !== expectedPageCount) {
    return {
      ok: false,
      message: `PDF page count mismatch: got ${pages.length}, expected ${expectedPageCount} (blank or missing page)`,
    };
  }

  for (let i = 0; i < pages.length; i += 1) {
    const { width, height } = pages[i].getSize();
    const portraitA5 =
      nearlyEqual(width, EXPECT_W_PT) &&
      nearlyEqual(height, EXPECT_H_PT) &&
      width <= height + SIZE_TOL_PT;
    if (!portraitA5) {
      return {
        ok: false,
        message: `PDF page ${i + 1} size mismatch: got ${width.toFixed(1)}×${height.toFixed(1)} pt, expected ~${EXPECT_W_PT.toFixed(1)}×${EXPECT_H_PT.toFixed(1)} pt (A5 portrait, no bleed)`,
      };
    }
  }

  return { ok: true };
}
