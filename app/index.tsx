import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { THEME } from '@/constants/theme';
import { getChildren, refreshChildrenFromCloudInBackground } from '@/services/children';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';
import { hasRealAuthAccount, peekHasRealAuthAccount } from '@/lib/authAccount';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import type { PostAuthOnboardingPath } from '@/utils/onboardingPermissionsRoute';

/**
 * Règle d'or V2 : compte d’abord, puis enfant.
 * Pas de compte → onboarding. Compte sans enfant → permissions (1×) ou create-child. Sinon tabs.
 * Ne jamais démarrer sur un enfant SQLite d’un autre e-mail (hydratation scopée).
 * Local-first : si session réelle + SQLite déjà plein → redirect immédiat (cloud en fond).
 * Important : `lastRealAuthUserId` seul ≠ compte actif (reste après déconnexion pour reconnect).
 */
export default function Index() {
  const [href, setHref] = useState<PostAuthOnboardingPath | '/onboarding' | null>(() => {
    if (!peekHasRealAuthAccount()) return null;
    hydrateTabScreensFromSqliteSync();
    const uid = peekLastRealAuthUserId();
    if (uid && listLocalChildrenForUser(uid).length > 0) {
      return '/(tabs)';
    }
    return null;
  });
  const [isChecking, setIsChecking] = useState(() => href === null);

  useEffect(() => {
    void (async () => {
      const accountOk = await hasRealAuthAccount();
      if (!accountOk) {
        setHref('/onboarding');
        setIsChecking(false);
        return;
      }

      const uid = peekLastRealAuthUserId();
      const localKids = uid ? listLocalChildrenForUser(uid) : [];
      if (localKids.length > 0) {
        setHref('/(tabs)');
        setIsChecking(false);
        refreshChildrenFromCloudInBackground();
        return;
      }

      // Cold : SQLite vide → pull cloud légitime avant redirect create-child vs tabs.
      const children = await getChildren();
      if (children.length > 0) {
        hydrateTabScreensFromSqliteSync();
        setHref('/(tabs)');
        setIsChecking(false);
        return;
      }

      const { resolvePostAuthOnboardingPath } = await import(
        '@/utils/onboardingPermissionsRoute'
      );
      setHref(await resolvePostAuthOnboardingPath(uid));
      setIsChecking(false);
    })();
  }, []);

  if (isChecking || !href) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={THEME.accent} />
      </View>
    );
  }

  return <Redirect href={href} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.bgScreen,
  },
});
