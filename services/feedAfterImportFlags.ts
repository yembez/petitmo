/**
 * Import média : `replace` vers le fil peut arriver avant que `pending` soit vu au 1er rendu,
 * et `loadData` non silencieux remet `isLoading` → roue. On arme un chargement silencieux
 * synchronement avant navigation.
 */
let silentInitialFilLoadArmed = false;

export function armSilentInitialFilLoadAfterMediaImport() {
  silentInitialFilLoadArmed = true;
}

export function peekSilentInitialFilLoadArmed(): boolean {
  return silentInitialFilLoadArmed;
}

export function consumeSilentInitialFilLoadAfterMediaImport(): boolean {
  const v = silentInitialFilLoadArmed;
  silentInitialFilLoadArmed = false;
  return v;
}
