import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Point d’entrée unique pour les retours haptiques.
 * Une haptique par geste — jamais pendant le scroll / autoplay.
 */

type HapticKind =
  | 'press'
  | 'selection'
  | 'favorite'
  | 'favoriteOff'
  | 'success'
  | 'warning'
  | 'destructive';

function canHaptic(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

export async function petitmoHaptic(kind: HapticKind): Promise<void> {
  if (!canHaptic()) return;
  try {
    switch (kind) {
      case 'press':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case 'selection':
        await Haptics.selectionAsync();
        return;
      case 'favorite':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case 'favoriteOff':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      case 'warning':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      case 'destructive':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        return;
      default:
        return;
    }
  } catch {
    /* simulateur / appareil sans moteur */
  }
}

/** Appui CTA / bouton — Light au pressIn. */
export function hapticPress(): void {
  void petitmoHaptic('press');
}

/** Changement d’onglet. */
export function hapticSelection(): void {
  void petitmoHaptic('selection');
}

/** Mise en favori (Medium). Retrait = Light, sans célébration. */
export function hapticFavorite(adding: boolean): void {
  void petitmoHaptic(adding ? 'favorite' : 'favoriteOff');
}

/** Achat / action confirmée. */
export function hapticSuccess(): void {
  void petitmoHaptic('success');
}

/** Suppression confirmée (irréversible). */
export function hapticDestructive(): void {
  void petitmoHaptic('destructive');
}
