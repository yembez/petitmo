import { DeviceEventEmitter } from 'react-native';
import type { ImmersiveSharedElement } from '@/utils/immersiveSharedElement';

/** Intentions de position du fil (survit au démontage de l’onglet / modale viewer). */
export type FeedScrollIntent =
  | { type: 'restore'; offsetY: number }
  /** Haut de liste (souvenir « maintenant »). */
  | { type: 'snapToLatest' }
  /**
   * Aligner sur une ligne (pending tempId ou memory id).
   * `animated: true` : glissement visible (rare).
   * Défaut / `false` : jump immédiat — **obligatoire** au retour immersif
   * (sinon le fil réaffiche d’abord le souvenir d’ouverture).
   * `measureKey` : clé host viewer (`id` ou `id-album-N`) pour le dézoom.
   */
  | { type: 'snapToKey'; key: string; animated?: boolean; measureKey?: string };

let pendingIntent: FeedScrollIntent | null = null;

/**
 * Callback one-shot : fil aligné + vignette mesurée (retour immersif cross-post).
 * Le viewer attend ça avant `runSharedDismiss` — sinon measure trop tôt → fade/jump.
 */
type ImmersiveReturnReadyCb = (shared: ImmersiveSharedElement | null) => void;
let immersiveReturnReadyCb: ImmersiveReturnReadyCb | null = null;

/**
 * Le fil sous un `transparentModal` reste souvent « focused » :
 * l’intent ne peut pas attendre un re-focus — le fil écoute cet event.
 */
export const PETITMO_FIL_APPLY_SCROLL_INTENT = 'petitmo:fil-apply-scroll-intent';

function notifyFilApplyScrollIntent(): void {
  DeviceEventEmitter.emit(PETITMO_FIL_APPLY_SCROLL_INTENT);
}

/**
 * Avant un `setMemories` qui retire une ligne : couper `maintainVisibleContentPosition`
 * le temps d’un commit (bug RN/Fabric — ancre recyclée → saut en bas de liste).
 */
export const PETITMO_FIL_SUSPEND_MVC_FOR_DELETE = 'petitmo:fil-suspend-mvc-for-delete';

export function notifyFilSuspendMvcForDelete(): void {
  DeviceEventEmitter.emit(PETITMO_FIL_SUSPEND_MVC_FOR_DELETE);
}

/** @deprecated préférer `notifyFilSuspendMvcForDelete` (toute suppression, pas seulement le newest). */
export const PETITMO_FIL_NEWEST_REMOVED = PETITMO_FIL_SUSPEND_MVC_FOR_DELETE;

/** @deprecated alias → `notifyFilSuspendMvcForDelete`. */
export function notifyFilNewestMemoryRemoved(): void {
  notifyFilSuspendMvcForDelete();
}

/** Restaurer un offset vertical exact au prochain focus du fil. */
export function setFeedScrollRestoreOffset(offsetY: number): void {
  pendingIntent = { type: 'restore', offsetY: Math.max(0, offsetY) };
  notifyFilApplyScrollIntent();
}

/** Après capture / import « maintenant » : au prochain focus du fil, haut de liste. */
export function armFeedSnapToLatestOnFocus(): void {
  pendingIntent = { type: 'snapToLatest' };
  notifyFilApplyScrollIntent();
}

/** Après import / retour immersif : scroller jusqu’à la carte. */
export function armFeedSnapToKeyOnFocus(
  key: string,
  opts?: { animated?: boolean; measureKey?: string },
): void {
  const k = key.trim();
  if (!k) {
    armFeedSnapToLatestOnFocus();
    return;
  }
  const measureKey = opts?.measureKey?.trim();
  pendingIntent = {
    type: 'snapToKey',
    key: k,
    animated: opts?.animated === true,
    ...(measureKey ? { measureKey } : {}),
  };
  notifyFilApplyScrollIntent();
}

/**
 * Retour immersif après swipe : snap fil + callback quand la vignette est
 * mesurable (pour le même spring dézoom que le retour « même post »).
 */
export function armFeedImmersiveReturnToKey(
  scrollKey: string,
  measureKey: string,
  onReady: ImmersiveReturnReadyCb,
): void {
  immersiveReturnReadyCb = onReady;
  armFeedSnapToKeyOnFocus(scrollKey, {
    animated: false,
    measureKey: measureKey.trim() || scrollKey,
  });
}

/** Appelé par le fil une fois aligné (ou en échec → `null`). */
export function completeFeedImmersiveReturn(
  shared: ImmersiveSharedElement | null,
): void {
  const cb = immersiveReturnReadyCb;
  immersiveReturnReadyCb = null;
  if (!cb) return;
  try {
    cb(shared);
  } catch {
    /* ignore */
  }
}

export function cancelFeedImmersiveReturn(): void {
  immersiveReturnReadyCb = null;
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
