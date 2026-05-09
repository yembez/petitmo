import { useEffect, useState } from 'react';
// NOTE: le logo Capture est forcé en blanc. On garde ces imports/commentaires
// comme historique de l'approche “adaptative”, mais ils ne sont plus nécessaires.

const DEFAULT_FILL = '#FFFFFF' as const;

/**
 * Couleur du logo manuscrit sur l’écran Capturer : blanc sur fond assez foncé,
 * noir (#1C1C1E) si la photo est trop claire (échantillon type moyenne / fond iOS).
 */
export function useCaptureHeroLogoColor(photoUri: string | null | undefined): {
  color: string;
  /** Halo noir uniquement derrière le tracé blanc */
  shadow: boolean;
} {
  // On force le logo en blanc : le scrim (dégradé foncé) du haut garantit le contraste.
  // Évite des bascules blanc/noir qui font “clignoter” l’identité visuelle.
  const [color, setColor] = useState<string>(DEFAULT_FILL);

  useEffect(() => {
    const uri = photoUri?.trim() ?? '';
    if (!uri) {
      setColor(DEFAULT_FILL);
      return;
    }

    let cancelled = false;

    const run = async () => {
      // Conserve la structure (future) mais fixe la couleur pour l’instant.
      // (On garde le code de palette commenté/retiré seulement si on le réactive plus tard.)
      void uri;
      if (!cancelled) setColor(DEFAULT_FILL);
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [photoUri]);

  return {
    color,
    shadow: color === DEFAULT_FILL,
  };
}
