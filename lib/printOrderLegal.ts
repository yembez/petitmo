import { LEGAL_TERMS_URL } from '@/lib/legalUrls';

/**
 * Acceptation légale commande livre imprimé (preuve + version CGV).
 * À bump quand le texte CGV livre change sur petitcoeur.app/terms.
 */
export const PRINT_ORDER_CGV_VERSION = '2026-09-17' as const;

export const PRINT_ORDER_CGV_URL = LEGAL_TERMS_URL;
