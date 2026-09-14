import type { View } from 'react-native';
import {
  isUsableSharedOrigin,
  measureViewInWindow,
  type ImmersiveSharedElement,
} from '@/utils/immersiveSharedElement';

type HostEntry = {
  getView: () => View | null;
  uri: string;
  cornerRadius: number;
};

const hosts = new Map<string, HostEntry>();

/** Enregistre le host média fil pour re-mesure au retour immersif (swipe → autre souvenir). */
export function registerFeedImmersiveHost(
  itemKey: string,
  entry: HostEntry | null,
): void {
  const key = itemKey.trim();
  if (!key) return;
  if (!entry) {
    hosts.delete(key);
    return;
  }
  hosts.set(key, entry);
}

export function unregisterFeedImmersiveHost(itemKey: string): void {
  const key = itemKey.trim();
  if (key) hosts.delete(key);
}

/**
 * Mesure la vignette fil pour une clé viewer (`memory.id` ou `id-album-N`).
 * Préférer scroller le fil sur la carte avant d’appeler.
 */
export function measureFeedImmersiveHost(
  itemKey: string,
  onResult: (shared: ImmersiveSharedElement | null) => void,
): void {
  const key = itemKey.trim();
  const entry = key ? hosts.get(key) : undefined;
  if (!entry) {
    onResult(null);
    return;
  }
  const uri = entry.uri.trim();
  if (!uri) {
    onResult(null);
    return;
  }
  measureViewInWindow(entry.getView(), origin => {
    if (!isUsableSharedOrigin(origin)) {
      onResult(null);
      return;
    }
    onResult({
      origin,
      uri,
      openedItemKey: key,
      cornerRadius: entry.cornerRadius,
    });
  });
}
