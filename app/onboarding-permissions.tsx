/**
 * Legacy route — l’écran « Active tes accès » n’est plus dans le happy path.
 * Redirect silencieux vers create-child ou tabs (Low Friction).
 */
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { THEME } from '@/constants/theme';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';

export default function OnboardingPermissionsScreen() {
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      const uid = peekLastRealAuthUserId();
      const { resolvePostAuthOnboardingPath } = await import(
        '@/utils/onboardingPermissionsRoute'
      );
      const path = await resolvePostAuthOnboardingPath(uid);
      if (path === '/(tabs)') {
        hydrateTabScreensFromSqliteSync();
      }
      router.replace(path);
    })();
  }, [router]);

  return (
    <View style={styles.boot}>
      <ActivityIndicator color={THEME.brandPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: THEME.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
