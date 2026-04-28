import { chromium, type Browser } from 'playwright';
import { validateDigitalPdfBytes } from './validateDigitalPdf';

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

/**
 * Rendu HTML → PDF via **Playwright / Chromium** (moteur d’impression Blink,
 * équivalent au pipeline historique Puppeteer + headless Chrome).
 * `@page` dans le HTML fixe le format (A5 digital ou A5 + fond perdu impression).
 */
async function htmlToPdfBufferRaw(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.emulateMedia({ media: 'print' });
    const buf = await page.pdf({
      printBackground: true,
      displayHeaderFooter: false,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      preferCSSPageSize: true,
    });
    return Buffer.from(buf);
  } finally {
    await page.close();
  }
}

/** PDF sans contrôle de format (digital ou impression / ticket print). */
export async function htmlToPdfBuffer(html: string): Promise<Buffer> {
  return htmlToPdfBufferRaw(html);
}

/**
 * Mode **digital** uniquement : A5 148×210 mm, marges PDF nulles, puis validation (`pdf-lib`).
 */
export async function htmlToDigitalPdfBuffer(html: string, expectedPageCount: number): Promise<Buffer> {
  const raw = await htmlToPdfBufferRaw(html);
  const check = await validateDigitalPdfBytes(raw, expectedPageCount);
  if (!check.ok) {
    throw new Error(check.message);
  }
  return raw;
}
