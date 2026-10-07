import { chromium, type Browser, type Page } from 'playwright';
import { validateDigitalPdfBytes } from './validateDigitalPdf';

let browserPromise: Promise<Browser> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Chromium headless-shell (défaut Playwright headless) peut SIGSEGV sur Railway.
 * `channel: 'chrome-for-testing'` force le binaire Chromium complet de l’image.
 */
async function launchBrowser(): Promise<Browser> {
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome-for-testing',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  });
  browser.on('disconnected', () => {
    browserPromise = null;
  });
  return browser;
}

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser().catch(err => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/** Pré-chauffe Chromium au boot (évite le 1ᵉʳ crash cold après redeploy). */
export async function warmPdfBrowser(): Promise<{ ok: boolean; error?: string }> {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setContent('<html><body>ok</body></html>', { waitUntil: 'load', timeout: 30_000 });
    await page.close();
    return { ok: true };
  } catch (e) {
    browserPromise = null;
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 240) : String(e) };
  }
}

async function getBrowserResilient(): Promise<Browser> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await getBrowser();
    } catch (e) {
      last = e;
      browserPromise = null;
      if (attempt < 3) await sleep(400 * attempt);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
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

function isTransientBrowserError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /Target page|browser has been closed|browserType\.launch|SIGSEGV|Protocol error|Connection closed|ECONNRESET/i.test(
    msg,
  );
}

/**
 * Rendu HTML → PDF via **Playwright / Chromium** (moteur d’impression Blink).
 * `@page` dans le HTML fixe le format (Gelato 21×28 digital ou trim + fond perdu impression).
 */
async function htmlToPdfBufferRaw(html: string): Promise<Buffer> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let page: Page | null = null;
    try {
      const browser = await getBrowserResilient();
      page = await browser.newPage();
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
    } catch (e) {
      last = e;
      browserPromise = null;
      if (!isTransientBrowserError(e) || attempt >= 3) throw e;
      console.warn(`[pdf] render retry ${attempt}/3`, e instanceof Error ? e.message : e);
      await sleep(600 * attempt);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch {
          /* ignore */
        }
      }
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
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
