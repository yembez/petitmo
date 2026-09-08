import { memo, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

type Props = {
  /** `true` tant que le visuel attendu n’est pas peint (import en cours, décodage, URL signée). */
  visible: boolean;
  /**
   * Délai avant apparition. Une photo déjà en cache se peint en moins d’une frame :
   * sans ce sas, la roue clignoterait à chaque rendu et donnerait l’impression d’une
   * attente réseau là où il n’y en a aucune.
   */
  delayMs?: number;
};

function BookPhotoLoadingOverlayInner({ visible, delayMs = 320 }: Props) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), delayMs);
    return () => clearTimeout(timer);
  }, [visible, delayMs]);

  if (!shown) return null;

  return (
    <View style={styles.host} pointerEvents="none">
      <View style={styles.disc}>
        <ActivityIndicator size="small" color="rgba(255,255,255,0.95)" />
      </View>
    </View>
  );
}

export default memo(BookPhotoLoadingOverlayInner);

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 4,
  },
  /** Même langage visuel que la pastille « Calcul qualité impression… ». */
  disc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28, 28, 30, 0.45)',
  },
});
