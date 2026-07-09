/** Max pages audio + vidéo avec QR par livre (tier free). 5 audio + 5 vidéo. */
export const FREE_TIER_QR_AV_MAX_PER_BOOK = 10;

/** Durée URL signée PDF renvoyée au client (secondes). Spec ~10 min. */
export const PDF_SIGNED_URL_SECONDS = 600;

/** Durée d’accès QR médias (`public_media_tokens` + legacy `qr_links`). Spec : 10 ans. */
export const BOOK_QR_MEDIA_EXPIRY_YEARS = 10;

export function bookPublicMediaExpiresAtIso(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + BOOK_QR_MEDIA_EXPIRY_YEARS);
  return d.toISOString();
}

/** Expiration lien QR legacy `qr_links` (même règle que les tokens publics). */
export function qrLinkExpiresAtIso(subscriptionTier: 'free' | 'premium'): string {
  void subscriptionTier;
  return bookPublicMediaExpiresAtIso();
}

/** Flux export sans compte (`qr_links_exports`) : durée longue fixe (spec produit). */
export const GUEST_EXPORT_QR_EXPIRY_YEARS = 10;

export function qrLinkExpiresAtIsoForExportRequest(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + GUEST_EXPORT_QR_EXPIRY_YEARS);
  return d.toISOString();
}
