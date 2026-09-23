/**
 * URLs publiques des pages juridiques (petitcoeur.app).
 * Source unique pour auth, paywall, Espace parent, commande livre, etc.
 *
 * Prod actuelle = SPA hash (`/#/privacy`). Les paths `/privacy` etc. nécessitent
 * un rewrite Vercel ; tant qu’il n’est pas actif, l’app doit ouvrir le hash.
 */
export const LEGAL_SITE_ORIGIN = 'https://petitcoeur.app' as const;

export const LEGAL_PRIVACY_URL = `${LEGAL_SITE_ORIGIN}/#/privacy` as const;
export const LEGAL_TERMS_URL = `${LEGAL_SITE_ORIGIN}/#/terms` as const;
/** Mentions légales (alias site : /legal, /mentions-legales). */
export const LEGAL_MENTIONS_URL = `${LEGAL_SITE_ORIGIN}/#/legal` as const;
