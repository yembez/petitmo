/**
 * Déclenche l’e-mail de confirmation commande (Edge `print-order-confirmation`, Resend)
 * une fois la commande Gelato acceptée. Fire-and-forget : jamais bloquant pour le fulfill.
 * Bearer = SUPABASE_SERVICE_ROLE_KEY (la clé Resend vit côté Supabase secrets).
 */
export function triggerPrintOrderConfirmationEmail(params: {
  projectOrigin: string;
  exportRequestId: string;
}): void {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const sharedSecret = (process.env.PRINT_ORDER_EMAIL_SECRET ?? '').trim();
  if (!serviceKey && !sharedSecret) {
    console.warn('[printOrderConfirmation] PRINT_ORDER_EMAIL_SECRET / SUPABASE_SERVICE_ROLE_KEY absents — mail non déclenché');
    return;
  }
  const url = `${params.projectOrigin.replace(/\/$/, '')}/functions/v1/print-order-confirmation`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  void fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${serviceKey || sharedSecret}`,
      ...(serviceKey ? { apikey: serviceKey } : {}),
      ...(sharedSecret ? { 'x-print-order-email-secret': sharedSecret } : {}),
    },
    body: JSON.stringify({ exportRequestId: params.exportRequestId }),
    signal: controller.signal,
  })
    .then(async res => {
      const text = await res.text().catch(() => '');
      if (res.ok) {
        console.log('[printOrderConfirmation] ok', params.exportRequestId, text.slice(0, 120));
      } else {
        console.error('[printOrderConfirmation] failed', params.exportRequestId, res.status, text.slice(0, 300));
      }
    })
    .catch(e => {
      console.error('[printOrderConfirmation] error', params.exportRequestId, e instanceof Error ? e.message : e);
    })
    .finally(() => clearTimeout(timer));
}
