import { jwtVerify } from 'jose';

const ISSUER = 'petitmo-init-export';

export type VerifiedExportTicket =
  | {
      kind: 'pdf';
      petitmo_ticket: 'export_pdf';
      export_request_id: string;
      crm_contact_id: string;
      book_id: string;
      subscription_tier: 'free' | 'paid';
    }
  | {
      kind: 'print';
      petitmo_ticket: 'export_print';
      export_request_id: string;
      crm_contact_id: string;
      book_id: string;
      subscription_tier: 'free' | 'paid';
    };

/** Vérifie le JWT émis par `init-export` (PDF ou impression). */
export async function verifyExportTicket(token: string): Promise<VerifiedExportTicket | null> {
  const secret = process.env.EXPORT_PDF_JWT_SECRET;
  if (!secret || secret.length < 32) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
    });
    const ticketKind = payload.petitmo_ticket;
    if (ticketKind !== 'export_pdf' && ticketKind !== 'export_print') return null;
    const export_request_id = typeof payload.export_request_id === 'string' ? payload.export_request_id : '';
    const crm_contact_id = typeof payload.crm_contact_id === 'string' ? payload.crm_contact_id : '';
    const book_id = typeof payload.book_id === 'string' ? payload.book_id : '';
    const subscription_tier =
      payload.subscription_tier === 'paid' || payload.subscription_tier === 'free'
        ? payload.subscription_tier
        : null;
    if (!export_request_id || !crm_contact_id || !book_id || !subscription_tier) return null;
    if (ticketKind === 'export_pdf') {
      return {
        kind: 'pdf',
        petitmo_ticket: 'export_pdf',
        export_request_id,
        crm_contact_id,
        book_id,
        subscription_tier,
      };
    }
    return {
      kind: 'print',
      petitmo_ticket: 'export_print',
      export_request_id,
      crm_contact_id,
      book_id,
      subscription_tier,
    };
  } catch {
    return null;
  }
}
