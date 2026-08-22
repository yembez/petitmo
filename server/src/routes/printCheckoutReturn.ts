import type { Express, Request, Response } from 'express';

const APP_RETURN = 'petitmo://book-order-return';

function safeEid(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const v = raw.trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(v) ? v : '';
}

/**
 * Stripe Checkout exige une URL https.
 * On n’utilise PAS location.replace(petitmo://) : dans Safari in-app ça laisse
 * une page blanche. L’iframe + bouton ouvrent l’app ; l’app ferme Safari dès
 * que le webhook marque paid.
 */
export function registerPrintCheckoutReturnRoute(app: Express): void {
  app.get('/v1/print-checkout-return', (req: Request, res: Response) => {
    const eid = safeEid(req.query.eid);
    const canceled = req.query.canceled === '1' || req.query.canceled === 'true';
    const qs = new URLSearchParams();
    if (canceled) qs.set('canceled', '1');
    else qs.set('paid', '1');
    if (eid) qs.set('eid', eid);
    const deep = `${APP_RETURN}?${qs.toString()}`;
    const escaped = deep.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const title = canceled ? 'Paiement annulé' : 'Ton livre prend vie';
    const sub = canceled
      ? 'Tu peux fermer cette fenêtre pour revenir dans Petitmo.'
      : 'Retour dans Petitmo — garde l’app ouverte pendant la préparation.';
    const cta = 'Ouvrir Petitmo';
    res
      .status(200)
      .set('Cache-Control', 'no-store')
      .type('html')
      .send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Petitmo</title>
  <style>
    html,body { margin:0; height:100%; background:#1C1C1E; color:#fff;
      font-family: system-ui, -apple-system, sans-serif; }
    body { display:flex; flex-direction:column; align-items:center; justify-content:center;
      padding:32px 24px; text-align:center; box-sizing:border-box; }
    .halo { width:96px; height:96px; border-radius:48px; background:#FD7764; opacity:.4;
      margin-bottom:8px; }
    h1 { font-size:22px; font-weight:700; margin:16px 0 10px; line-height:1.3; }
    p { font-size:16px; color:rgba(255,255,255,.78); line-height:1.5; max-width:320px; margin:0 0 28px; }
    a { display:inline-block; background:#FD7764; color:#fff; text-decoration:none;
      font-weight:700; font-size:16px; padding:14px 28px; border-radius:14px; }
  </style>
</head>
<body>
  <div class="halo" aria-hidden="true"></div>
  <h1>${title}</h1>
  <p>${sub}</p>
  <a href="${escaped}">${cta}</a>
  <iframe src="${escaped}" style="display:none;width:0;height:0;border:0" aria-hidden="true"></iframe>
</body>
</html>`);
  });
}
