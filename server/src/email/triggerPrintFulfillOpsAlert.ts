/**
 * Mail support@ sur échec permanent PDF/Gelato (Edge `print-fulfill-ops-alert`).
 * Fire-and-forget — jamais bloquant pour le fulfill.
 */
export function triggerPrintFulfillOpsAlert(params: {
  projectOrigin: string;
  exportRequestId: string;
  lastError: string;
  attemptCount: number;
  /** fulfill_permanent (défaut) | confirmation_email (Gelato OK, mail cliente KO). */
  alertKind?: 'fulfill_permanent' | 'confirmation_email';
}): void {
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  const sharedSecret = (process.env.PRINT_ORDER_EMAIL_SECRET ?? '').trim();
  if (!serviceKey && !sharedSecret) {
    console.warn('[printFulfillOpsAlert] secret absent — mail support non déclenché');
    return;
  }
  const url = `${params.projectOrigin.replace(/\/$/, '')}/functions/v1/print-fulfill-ops-alert`;
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
    body: JSON.stringify({
      exportRequestId: params.exportRequestId,
      lastError: params.lastError.slice(0, 2000),
      attemptCount: params.attemptCount,
      alertKind: params.alertKind ?? 'fulfill_permanent',
    }),
    signal: controller.signal,
  })
    .then(async res => {
      const text = await res.text().catch(() => '');
      if (res.ok) {
        console.log('[printFulfillOpsAlert] ok', params.exportRequestId, text.slice(0, 120));
      } else {
        console.error(
          '[printFulfillOpsAlert] failed',
          params.exportRequestId,
          res.status,
          text.slice(0, 300),
        );
      }
    })
    .catch(e => {
      console.error(
        '[printFulfillOpsAlert] error',
        params.exportRequestId,
        e instanceof Error ? e.message : e,
      );
    })
    .finally(() => clearTimeout(timer));
}
