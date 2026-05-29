/** Intentions de position du fil (survit au démontage de l’onglet / modale viewer). */
export type FeedScrollIntent =
  | { type: 'restore'; offsetY: number }
  | { type: 'snapToLatest' };

let pendingIntent: FeedScrollIntent | null = null;

/** Retour viewer immersif : restaurer l’offset vertical exact. */
export function setFeedScrollRestoreOffset(offsetY: number): void {
  pendingIntent = { type: 'restore', offsetY: Math.max(0, offsetY) };
}

/** Après capture / import : au prochain focus du fil, afficher le dernier post (haut) sans animation visible. */
export function armFeedSnapToLatestOnFocus(): void {
  pendingIntent = { type: 'snapToLatest' };
}

export function consumeFeedScrollIntent(): FeedScrollIntent | null {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}

/** @deprecated Préférer `consumeFeedScrollIntent`. */
export function consumeFeedScrollRestoreOffset(): number | null {
  const intent = consumeFeedScrollIntent();
  return intent?.type === 'restore' ? intent.offsetY : null;
}
