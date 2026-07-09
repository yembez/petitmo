/** Routes des onglets `(tabs)`. `index` = Capturer (+). */
export type MainTabRoute = 'fil' | 'favoris' | 'livres' | 'index';

export type TabBarSlot =
  | { kind: 'settings' }
  | { kind: 'tab'; route: MainTabRoute };

/**
 * Barre fixe (5 emplacements) : Paramètres · Favoris · + · Journal · Livres.
 * L’onglet actif reste visible (plus de barre « contextuelle » à 3 CTA).
 */
export const FIXED_TAB_BAR_SLOTS: TabBarSlot[] = [
  { kind: 'settings' },
  { kind: 'tab', route: 'favoris' },
  { kind: 'tab', route: 'index' },
  { kind: 'tab', route: 'fil' },
  { kind: 'tab', route: 'livres' },
];

export function normalizeMainTabRoute(name: string | undefined): MainTabRoute {
  if (name === 'fil' || name === 'favoris' || name === 'livres' || name === 'index') {
    return name;
  }
  return 'index';
}
