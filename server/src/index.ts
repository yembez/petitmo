import express from 'express';
import { loadEnv } from './env';
import { createSupabaseAdmin } from './supabaseAdmin';
import { registerQrRoutes } from './routes/qr';
import { registerGeneratePdfRoute } from './routes/generatePdf';
import { registerUploadGuestAssetsRoutes } from './routes/uploadGuestAssets';
import { registerUploadGuestAssetRoute } from './routes/uploadGuestAsset';
import { registerPublicMediaRoutes } from './routes/publicMedia';
import { registerResolvePublicMediaTokensRoute } from './routes/resolvePublicMediaTokens';
import { registerRemapPublicMediaTokensRoute } from './routes/remapPublicMediaTokens';
import { registerGelatoWebhookRoute } from './routes/gelatoWebhook';
import { registerPrintCheckoutReturnRoute } from './routes/printCheckoutReturn';
import { registerStashPrintPayloadRoute } from './routes/stashPrintPayload';
import { registerPrintFulfillRoutes } from './routes/printFulfill';
import {
  DIGITAL_PAGE_HEIGHT_MM,
  DIGITAL_PAGE_WIDTH_MM,
  PRINT_BLEED_MM,
  PRINT_PAGE_HEIGHT_MM,
  PRINT_PAGE_WIDTH_MM,
} from './constants/pdfDigitalSpec';
import { warmPdfBrowser } from './pdf/renderPdf';
import { startPrintFulfillRetryScheduler } from './print/printFulfillRetryWorker';

type BrowserWarmState = {
  ok: boolean;
  at: string;
  error?: string;
};

function main(): void {
  const env = loadEnv();
  const app = express();
  let browserWarm: BrowserWarmState | null = null;

  if (env.trustProxy) {
    app.set('trust proxy', 1);
  }

  // Minimal request log (useful in Docker logs)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      const ua = String(req.headers['user-agent'] ?? '').slice(0, 80);
      console.log(`[http] ${req.method} ${req.path} -> ${res.statusCode} (${ms}ms) ua=${ua}`);
    });
    next();
  });

  // `generate-pdf` + upload guest assets peuvent transporter des payloads importants (ex. photo base64).
  // On fixe une limite globale plus haute pour éviter les PayloadTooLargeError avant le router.
  app.use(express.json({ limit: '60mb' }));

  // Healthcheck Railway : rester synchrone/rapide (ne pas attendre Chromium).
  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'petitmo-pdf-server',
      pdfFormat: {
        digitalMm: [DIGITAL_PAGE_WIDTH_MM, DIGITAL_PAGE_HEIGHT_MM],
        printPageMm: [PRINT_PAGE_WIDTH_MM, PRINT_PAGE_HEIGHT_MM],
        bleedMm: PRINT_BLEED_MM,
      },
      qrWorker: '2026-09-07-petit-coeur-logo',
      browser: browserWarm,
    });
  });

  const supabase = createSupabaseAdmin(env.supabaseUrl, env.supabaseServiceRoleKey);
  registerQrRoutes(app, supabase);
  registerPublicMediaRoutes(app, supabase);
  registerResolvePublicMediaTokensRoute(app, supabase);
  registerRemapPublicMediaTokensRoute(app, supabase);
  registerGeneratePdfRoute(app, supabase, env.supabaseUrl);
  registerStashPrintPayloadRoute(app, supabase, env.supabaseUrl);
  registerPrintFulfillRoutes(app, supabase, env.supabaseUrl, env.supabaseServiceRoleKey);
  registerGelatoWebhookRoute(app, supabase);
  registerPrintCheckoutReturnRoute(app);
  registerUploadGuestAssetsRoutes(app, supabase);
  registerUploadGuestAssetRoute(app, supabase);

  app.listen(env.port, () => {
    console.log(`petitmo-pdf-server listening on :${env.port}`);
    void warmPdfBrowser().then(r => {
      browserWarm = { ...r, at: new Date().toISOString() };
      console.log('[pdf] browser warm', browserWarm);
    });
    startPrintFulfillRetryScheduler({
      supabase,
      projectOrigin: env.supabaseUrl.replace(/\/$/, ''),
    });
  });
}

main();
