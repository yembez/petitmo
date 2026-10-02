/**
 * Overlay plein écran déconnexion / suppression — monté à la racine
 * pour survivre au unmount d’Espace parent (évite flash du menu).
 */
import { DeviceEventEmitter } from 'react-native';

export const ACCOUNT_CLOSING_UI_EVENT = 'petitmo:account-closing-ui';

export type AccountClosingMode = 'signOut' | 'delete';

export type AccountClosingUiState = {
  visible: boolean;
  mode: AccountClosingMode;
};

let state: AccountClosingUiState = {
  visible: false,
  mode: 'signOut',
};

function emit(): void {
  DeviceEventEmitter.emit(ACCOUNT_CLOSING_UI_EVENT, peekAccountClosingUi());
}

export function peekAccountClosingUi(): AccountClosingUiState {
  return { ...state };
}

export function beginAccountClosingUi(mode: AccountClosingMode): void {
  state = { visible: true, mode };
  emit();
}

export function endAccountClosingUi(): void {
  if (!state.visible) return;
  state = { visible: false, mode: 'signOut' };
  emit();
}
