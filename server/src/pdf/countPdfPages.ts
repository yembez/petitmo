import { PDFDocument } from 'pdf-lib';

/** Nombre de pages d’un buffer PDF (pour Gelato pageCount). */
export async function countPdfPages(pdfBytes: Buffer): Promise<number> {
  const doc = await PDFDocument.load(pdfBytes);
  return doc.getPageCount();
}
