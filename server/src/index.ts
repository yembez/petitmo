import express from 'express';
import { loadEnv } from './env';
import { createSupabaseAdmin } from './supabaseAdmin';
import { registerQrRoutes } from './routes/qr';
import { registerGeneratePdfRoute } from './routes/generatePdf';

function main(): void {
  const env = loadEnv();
  const app = express();

  if (env.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(express.json({ limit: '2mb' }));

  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true, service: 'petitmo-pdf-server' });
  });

  const supabase = createSupabaseAdmin(env.supabaseUrl, env.supabaseServiceRoleKey);
  registerQrRoutes(app, supabase);
  registerGeneratePdfRoute(app, supabase);

  app.listen(env.port, () => {
    console.log(`petitmo-pdf-server listening on :${env.port}`);
  });
}

main();
