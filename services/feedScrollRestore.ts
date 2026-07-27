/** Intentions de position du fil (survit au démontage de l’onglet / modale viewer). */
export type FeedScrollIntent =
  | { type: 'restore'; offsetY: number }
  /** Haut de liste (souvenir « maintenant »). */
  | { type: 'snapToLatest' }
  /** Aligner sur une ligne (pending tempId ou memory id) — ex. import daté EXIF. */
  | { type: 'snapToKey'; key: string };

let pendingIntent: FeedScrollIntent | null = null;

/** Retour viewer immersif : restaurer l’offset vertical exact. */
export function setFeedScrollRestoreOffset(offsetY: number): void {
  pendingIntent = { type: 'restore', offsetY: Math.max(0, offsetY) };
}

/** Après capture / import « maintenant » : au prochain focus du fil, haut de liste. */
export function armFeedSnapToLatestOnFocus(): void {
  pendingIntent = { type: 'snapToLatest' };
}

/** Après import : scroller jusqu’à la carte (bonne place chronologique). */
export function armFeedSnapToKeyOnFocus(key: string): void {
  const k = key.trim();
  if (!k) {
    armFeedSnapToLatestOnFocus();
    return;
  }
  pendingIntent = { type: 'snapToKey', key: k };
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
