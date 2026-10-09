/**
 * Kick Railway print-fulfill après payment_status=paid (fire-and-forget).
 * Auth : `PRINT_FULFILL_SECRET` (préféré, partagé Railway ↔ Edge) puis repli
 * `SUPABASE_SERVICE_ROLE_KEY` (souvent désynchronisé → 401 sur /v1/internal/print-fulfill).
 */

const PRODUCTION_PDF_SERVER = 'https://petitmo-production.up.railway.app';

export function pdfServerBaseUrl(): string {
  const fromEnv = (Deno.env.get('PDF_SERVER_URL') ?? '').trim().replace(/\/$/, '');
  return fromEnv || PRODUCTION_PDF_SERVER;
}

function printFulfillBearer(): string {
  const shared = (Deno.env.get('PRINT_FULFILL_SECRET') ?? '').trim();
  if (shared) return shared;
  return (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
}

/** Ne bloque pas le webhook / Edge : timeout court, erreurs loguées seulement. */
export function triggerPrintFulfillInBackground(exportRequestId: string): void {
  const id = exportRequestId.trim();
  if (!id) return;
  const bearer = printFulfillBearer();
  if (!bearer) {
    console.error('[triggerPrintFulfill] missing PRINT_FULFILL_SECRET / SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  const url = `${pdfServerBaseUrl()}/v1/internal/print-fulfill`;
  void (async () => {
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 8_000);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ exportRequestId: id }),
        signal: ac.signal,
      });
      clearTimeout(t);
      if (!res.ok && res.status !== 202) {
        const text = await res.text().catch(() => '');
        console.error('[triggerPrintFulfill]', res.status, text.slice(0, 300));
      } else {
        console.log('[triggerPrintFulfill] kicked', id, res.status);
      }
    } catch (e) {
      console.error('[triggerPrintFulfill]', e instanceof Error ? e.message : String(e));
    }
  })();
}
