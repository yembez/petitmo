/**
 * Détection douce d’e-mail suspect (commande livre) — jamais bloquant (Low Friction).
 * - faute de frappe de domaine / TLD connue → suggestion ;
 * - partie locale très courte (ex. « s@… ») → probable frappe perdue ;
 * - différent de l’e-mail du compte → simple rappel.
 */

export type EmailHint =
  | { kind: 'typo'; suggestion: string }
  | { kind: 'short' }
  | { kind: 'differsFromAccount'; accountEmail: string };

/** Domaines fréquents mal tapés → domaine corrigé. */
const DOMAIN_FIXES: Record<string, string> = {
  'gmail.con': 'gmail.com',
  'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com',
  'gmail.fr': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmil.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'gamil.com': 'gmail.com',
  'gnail.com': 'gmail.com',
  'hotmail.con': 'hotmail.com',
  'hotmal.com': 'hotmail.com',
  'hotmai.com': 'hotmail.com',
  'hotmail.fe': 'hotmail.fr',
  'outlook.con': 'outlook.com',
  'outlook.fe': 'outlook.fr',
  'yahoo.con': 'yahoo.com',
  'yahoo.fe': 'yahoo.fr',
  'icloud.con': 'icloud.com',
  'icoud.com': 'icloud.com',
  'orange.fe': 'orange.fr',
  'wanadoo.fe': 'wanadoo.fr',
  'free.fe': 'free.fr',
  'sfr.fe': 'sfr.fr',
  'laposte.ne': 'laposte.net',
  'laposte.nt': 'laposte.net',
};

/** TLD mal tapés → TLD corrigé (si le domaine n’est pas dans la table ci-dessus). */
const TLD_FIXES: Record<string, string> = {
  con: 'com',
  cmo: 'com',
  ocm: 'com',
  comm: 'com',
  fe: 'fr',
  frr: 'fr',
  rf: 'fr',
  nte: 'net',
  ner: 'net',
};

const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function suggestEmailFix(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (!SIMPLE_EMAIL_RE.test(email)) return null;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  const fixedDomain = DOMAIN_FIXES[domain];
  if (fixedDomain) return `${local}@${fixedDomain}`;

  const dot = domain.lastIndexOf('.');
  if (dot > 0) {
    const name = domain.slice(0, dot);
    const tld = domain.slice(dot + 1);
    const fixedTld = TLD_FIXES[tld];
    if (fixedTld) return `${local}@${name}.${fixedTld}`;
  }
  return null;
}

export function getEmailHint(raw: string, accountEmailRaw?: string | null): EmailHint | null {
  const email = normalizeEmail(raw);
  if (!SIMPLE_EMAIL_RE.test(email)) return null;

  const suggestion = suggestEmailFix(email);
  if (suggestion && suggestion !== email) return { kind: 'typo', suggestion };

  const local = email.slice(0, email.lastIndexOf('@'));
  if (local.length <= 2) return { kind: 'short' };

  const account = normalizeEmail(accountEmailRaw ?? '');
  if (account && SIMPLE_EMAIL_RE.test(account) && account !== email) {
    return { kind: 'differsFromAccount', accountEmail: account };
  }
  return null;
}
