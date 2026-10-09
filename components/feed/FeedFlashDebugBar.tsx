import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  clearFeedFlashDebugEvents,
  feedFlashMarkSeen,
  hydrateFeedFlashDebug,
  isFeedFlashDebugEnabled,
  setFeedFlashDebugEnabled,
  shareFeedFlashDebugDump,
  subscribeFeedFlashDebug,
} from '@/lib/feedFlashDebug';
import { scale } from '@/utils/responsive';

/**
 * Barre debug flash fil — visible seulement si activée (appui long titre header).
 * « J’ai vu le flash » marque l’instant ; « Exporter » → coller dans le chat Cursor.
 */
export default function FeedFlashDebugBar() {
  const insets = useSafeAreaInsets();
  const [on, setOn] = useState(isFeedFlashDebugEnabled);

  useEffect(() => {
    void hydrateFeedFlashDebug().then(() => setOn(isFeedFlashDebugEnabled()));
    return subscribeFeedFlashDebug(() => setOn(isFeedFlashDebugEnabled()));
  }, []);

  if (!on) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, scale(8)) + scale(56) }]}
    >
      <View style={styles.bar}>
        <Pressable
          onPress={() => feedFlashMarkSeen()}
          style={({ pressed }) => [styles.btn, styles.btnFlash, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Marquer le flash vu"
        >
          <Text style={styles.btnText}>J’ai vu le flash</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void shareFeedFlashDebugDump();
          }}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Exporter les logs flash"
        >
          <Text style={styles.btnText}>Exporter</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            clearFeedFlashDebugEvents();
          }}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Vider les logs"
        >
          <Text style={styles.btnText}>Vider</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            void setFeedFlashDebugEnabled(false);
          }}
          style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Désactiver le debug flash"
        >
          <Text style={styles.btnText}>Off</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: scale(8),
    right: scale(8),
    zIndex: 9999,
    elevation: 20,
  },
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: scale(6),
    backgroundColor: 'rgba(20,20,20,0.88)',
    borderRadius: scale(10),
    padding: scale(8),
  },
  btn: {
    paddingHorizontal: scale(10),
    paddingVertical: scale(8),
    borderRadius: scale(8),
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  btnFlash: {
    backgroundColor: '#D9683A',
  },
  pressed: {
    opacity: 0.75,
  },
  btnText: {
    color: '#FFFFFF',
    fontSize: scale(12),
    fontWeight: '600',
  },
});
