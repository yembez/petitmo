import { chromium, type Browser, type Page } from 'playwright';
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
 * Attend le decode de chaque `img.crop-img` (médias page / couverture).
 * Évite un PDF où la date est peinte mais l’image HTTPS n’a pas encore chargé.
 * Échoue si une image crop a naturalWidth=0 (URL morte / 403) — mieux qu’une page blanche Gelato.
 */
async function waitForCropImagesOrThrow(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img.crop-img'));
    await Promise.all(
      imgs.map(
        img =>
          new Promise<void>(resolve => {
            if (img.complete) {
              resolve();
              return;
            }
            const done = () => resolve();
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          }),
      ),
    );
    const failed = imgs
      .filter(img => !(img.naturalWidth > 0 && img.naturalHeight > 0))
      .map(img => (img.currentSrc || img.src || '').slice(0, 160));
    return { total: imgs.length, failed };
  });

  if (result.failed.length > 0) {
    throw new Error(
      `PDF_CROP_IMAGE_LOAD_FAILED (${result.failed.length}/${result.total}): ${result.failed.join(' | ')}`,
    );
  }
}

/**
 * Rendu HTML → PDF via **Playwright / Chromium** (moteur d’impression Blink).
 * `@page` dans le HTML fixe le format (Gelato 21×28 digital ou trim + fond perdu impression).
 */
async function htmlToPdfBufferRaw(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // `networkidle` peut ne jamais se déclencher (fonts Google, images lentes) → timeout Railway → 502.
    await page.setContent(html, { waitUntil: 'load', timeout: 120_000 });
    await page.evaluate(() => document.fonts.ready);
    await waitForCropImagesOrThrow(page);
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
 * Mode **digital** uniquement : Gelato 210×280 mm, marges PDF nulles, puis validation (`pdf-lib`).
 */
export async function htmlToDigitalPdfBuffer(html: string, expectedPageCount: number): Promise<Buffer> {
  const raw = await htmlToPdfBufferRaw(html);
  const check = await validateDigitalPdfBytes(raw, expectedPageCount);
  if (!check.ok) {
    throw new Error(check.message);
  }
  return raw;
}
