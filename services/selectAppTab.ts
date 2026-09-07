import { DeviceEventEmitter } from 'react-native';

export const PETITMO_SELECT_TAB = 'petitmo:select-tab';

export type AppTabName = 'fil' | 'index' | 'favoris' | 'livres';

/** Bascule un onglet des `(tabs)` sans toucher à la pile (ex. sous un fullScreenModal). */
export function selectAppTab(name: AppTabName): void {
  DeviceEventEmitter.emit(PETITMO_SELECT_TAB, { name });
}
