import express from 'express';
import { loadEnv } from './env';
import { createSupabaseAdmin } from './supabaseAdmin';
import { registerQrRoutes } from './routes/qr';
import { registerGeneratePdfRoute } from './routes/generatePdf';
import { registerUploadGuestAssetsRoutes } from './routes/uploadGuestAssets';
import { registerUploadGuestAssetRoute } from './routes/uploadGuestAsset';
import { registerPublicMediaRoutes } from './routes/publicMedia';
import { registerResolvePublicMediaTokensRoute } from './routes/resolvePublicMediaTokens';
import {
  DIGITAL_PAGE_HEIGHT_MM,
  DIGITAL_PAGE_WIDTH_MM,
  PRINT_BLEED_MM,
  PRINT_PAGE_HEIGHT_MM,
  PRINT_PAGE_WIDTH_MM,
} from './constants/pdfDigitalSpec';

function main(): void {
  const env = loadEnv();
  const app = express();

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

  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'petitmo-pdf-server',
      pdfFormat: {
        digitalMm: [DIGITAL_PAGE_WIDTH_MM, DIGITAL_PAGE_HEIGHT_MM],
        printPageMm: [PRINT_PAGE_WIDTH_MM, PRINT_PAGE_HEIGHT_MM],
        bleedMm: PRINT_BLEED_MM,
      },
    });
  });

  const supabase = createSupabaseAdmin(env.supabaseUrl, env.supabaseServiceRoleKey);
  registerQrRoutes(app, supabase);
  registerPublicMediaRoutes(app, supabase);
  registerResolvePublicMediaTokensRoute(app, supabase);
  registerGeneratePdfRoute(app, supabase, env.supabaseUrl);
  registerUploadGuestAssetsRoutes(app, supabase);
  registerUploadGuestAssetRoute(app, supabase);

  app.listen(env.port, () => {
    console.log(`petitmo-pdf-server listening on :${env.port}`);
  });
}

main();
