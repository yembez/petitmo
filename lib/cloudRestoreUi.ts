/**
 * Attente douce restore cloud — uniquement SQLite souvenirs vide (réinstall / nouveau device).
 * Visible après 2 s (spec). Jamais si le local a déjà des souvenirs (local-first).
 */
import { DeviceEventEmitter } from 'react-native';

export const CLOUD_RESTORE_UI_EVENT = 'petitmo:cloud-restore-ui';

/** Court délai anti-flash ; assez bas pour être visible dès une réinstall TestFlight. */
const SHOW_AFTER_MS = 400;
/** Garde-fou : ne jamais bloquer l’UI indéfiniment. */
export const CLOUD_RESTORE_MAX_MS = 120_000;

export type CloudRestoreUiState = {
  active: boolean;
  /** Affiché seulement après SHOW_AFTER_MS. */
  visible: boolean;
  childName: string | null;
};

let state: CloudRestoreUiState = {
  active: false,
  visible: false,
  childName: null,
};

let showTimer: ReturnType<typeof setTimeout> | null = null;
let depth = 0;

function emit(): void {
  DeviceEventEmitter.emit(CLOUD_RESTORE_UI_EVENT, peekCloudRestoreUi());
}

export function peekCloudRestoreUi(): CloudRestoreUiState {
  return { ...state };
}

export function beginCloudRestoreUi(opts?: { childName?: string | null }): void {
  depth += 1;
  if (depth > 1) {
    if (opts?.childName?.trim() && !state.childName) {
      state = { ...state, childName: opts.childName.trim() };
      emit();
    }
    return;
  }

  const name = opts?.childName?.trim() || null;
  state = { active: true, visible: false, childName: name };
  emit();

  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    showTimer = null;
    if (!state.active) return;
    state = { ...state, visible: true };
    emit();
  }, SHOW_AFTER_MS);
}

export function endCloudRestoreUi(): void {
  depth = Math.max(0, depth - 1);
  if (depth > 0) return;

  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  state = { active: false, visible: false, childName: null };
  emit();
}
