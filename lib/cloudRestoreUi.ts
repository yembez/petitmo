/**
 * Attente douce restore cloud — uniquement SQLite souvenirs vide (réinstall / nouveau device).
 * `immediate` : visible tout de suite (évite flash Capturer avant l’overlay).
 */
import { DeviceEventEmitter } from 'react-native';

export const CLOUD_RESTORE_UI_EVENT = 'petitmo:cloud-restore-ui';

/** Anti-flash si restore ultra-court ; ignorer si `immediate`. */
const SHOW_AFTER_MS = 120;
/** Garde-fou : ne jamais bloquer l’UI indéfiniment. */
export const CLOUD_RESTORE_MAX_MS = 120_000;

export type CloudRestoreUiState = {
  active: boolean;
  /** Affiché seulement après SHOW_AFTER_MS (ou tout de suite si immediate). */
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

export function beginCloudRestoreUi(opts?: {
  childName?: string | null;
  /** Réinstall / login : pas de délai — sinon Capturer flash avant l’overlay. */
  immediate?: boolean;
}): void {
  depth += 1;
  if (depth > 1) {
    if (opts?.childName?.trim() && !state.childName) {
      state = { ...state, childName: opts.childName.trim() };
      emit();
    }
    if (opts?.immediate && state.active && !state.visible) {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
      state = { ...state, visible: true };
      emit();
    }
    return;
  }

  const name = opts?.childName?.trim() || null;
  const immediate = opts?.immediate === true;
  state = { active: true, visible: immediate, childName: name };
  emit();

  if (showTimer) clearTimeout(showTimer);
  showTimer = null;
  if (!immediate) {
    showTimer = setTimeout(() => {
      showTimer = null;
      if (!state.active) return;
      state = { ...state, visible: true };
      emit();
    }, SHOW_AFTER_MS);
  }
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
