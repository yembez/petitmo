/** Routes des onglets `(tabs)`. `index` = Capturer. */
export type MainTabRoute = 'fil' | 'favoris' | 'livres' | 'index';

/**
 * Barre unique (4 onglets, ordre maquette) : Capturer · Journal · Favoris · Livres.
 * Paramètres vit dans le header des écrans Capturer / Journal / Livres.
 */
export const FIXED_TAB_BAR_SLOTS: MainTabRoute[] = ['index', 'fil', 'favoris', 'livres'];

export function normalizeMainTabRoute(name: string | undefined): MainTabRoute {
  if (name === 'fil' || name === 'favoris' || name === 'livres' || name === 'index') {
    return name;
  }
  return 'index';
}
