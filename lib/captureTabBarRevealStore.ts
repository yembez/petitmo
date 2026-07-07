/** Tab bar Capturer : repliée hors écran par défaut, révélée via la flèche footer. */
let revealed = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function getCaptureTabBarRevealed(): boolean {
  return revealed;
}

export function setCaptureTabBarRevealed(next: boolean): void {
  if (revealed === next) return;
  revealed = next;
  emit();
}

export function toggleCaptureTabBarRevealed(): void {
  setCaptureTabBarRevealed(!revealed);
}

export function resetCaptureTabBarReveal(): void {
  setCaptureTabBarRevealed(false);
}

export function subscribeCaptureTabBarReveal(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}
