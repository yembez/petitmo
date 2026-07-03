/** Base publique des QR livre (`/m/{token}`), sans slash final. */
export function publicMediaBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL?.trim();
  if (raw) return raw.replace(/\/$/, '');
  const pdf = process.env.EXPO_PUBLIC_PDF_SERVER_URL?.trim();
  if (pdf) return `${pdf.replace(/\/$/, '')}/m`;
  return 'https://petitmo.app/m';
}

export function bookQrUrlForToken(token: string): string {
  const t = token.trim();
  if (!t) return '';
  return `${publicMediaBaseUrl()}/${t}`;
}
