/** Max pages audio + vidéo avec QR par livre (tier free). Spec §1 / §4. */
export const FREE_TIER_QR_AV_MAX_PER_BOOK = 10;

/** Durée URL signée PDF renvoyée au client (secondes). Spec ~10 min. */
export const PDF_SIGNED_URL_SECONDS = 600;

/** Expiration lien QR média en base (free : 3 ans). Spec §4. */
export function qrLinkExpiresAtIso(subscriptionTier: 'free' | 'premium'): string {
  const years = subscriptionTier === 'free' ? 3 : 10;
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

/** Flux export sans compte (`qr_links_exports`) : durée longue fixe (spec produit). */
export const GUEST_EXPORT_QR_EXPIRY_YEARS = 10;

export function qrLinkExpiresAtIsoForExportRequest(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + GUEST_EXPORT_QR_EXPIRY_YEARS);
  return d.toISOString();
}
