/** Routes principales des onglets `(tabs)`. `index` = Capturer. */
export type MainTabRoute = 'fil' | 'favoris' | 'livres' | 'index';

/**
 * 3 CTA visibles : l’onglet actif est retiré.
 * Fil actif : Favoris · + · Livres. Capturer actif : Favoris · Journal · Livres.
 */
export function contextualTabBarRoutes(active: MainTabRoute): MainTabRoute[] {
  switch (active) {
    case 'fil':
      return ['favoris', 'index', 'livres'];
    case 'favoris':
      return ['livres', 'index', 'fil'];
    case 'livres':
      return ['favoris', 'index', 'fil'];
    case 'index':
      return ['favoris', 'fil', 'livres'];
    default:
      return ['livres', 'index', 'favoris'];
  }
}

export function normalizeMainTabRoute(name: string | undefined): MainTabRoute {
  if (name === 'fil' || name === 'favoris' || name === 'livres' || name === 'index') {
    return name;
  }
  return 'index';
}
