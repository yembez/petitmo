import { jwtVerify } from 'npm:jose@5.9.6';

const ISSUER = 'petitmo-init-export';

export type VerifiedPrintTicket = {
  petitmo_ticket: 'export_print';
  export_request_id: string;
  crm_contact_id: string;
  book_id: string;
  subscription_tier: 'free' | 'paid';
};

export async function verifyExportPrintTicket(token: string): Promise<VerifiedPrintTicket | null> {
  const secret = Deno.env.get('EXPORT_PDF_JWT_SECRET') ?? '';
  if (!secret || secret.length < 32) {
    console.error('[print-payment] EXPORT_PDF_JWT_SECRET missing or too short');
    return null;
  }
  const raw = token.replace(/^Bearer\s+/i, '').trim();
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      clockTolerance: 120,
    });
    if (payload.petitmo_ticket !== 'export_print') return null;
    const export_request_id = typeof payload.export_request_id === 'string' ? payload.export_request_id : '';
    const crm_contact_id = typeof payload.crm_contact_id === 'string' ? payload.crm_contact_id : '';
    const book_id = typeof payload.book_id === 'string' ? payload.book_id : '';
    const subscription_tier =
      payload.subscription_tier === 'paid' || payload.subscription_tier === 'free'
        ? payload.subscription_tier
        : null;
    if (!export_request_id || !crm_contact_id || !book_id || !subscription_tier) return null;
    return {
      petitmo_ticket: 'export_print',
      export_request_id,
      crm_contact_id,
      book_id,
      subscription_tier,
    };
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
    console.warn('[print-payment] ticket verify failed', code || (e instanceof Error ? e.message : 'unknown'));
    return null;
  }
}
