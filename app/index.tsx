import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { THEME } from '@/constants/theme';
import { listLocalChildren } from '@/lib/localDb';
import { getChildren } from '@/services/children';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';
import { hasRealAuthAccount } from '@/lib/authAccount';

/**
 * Règle d'or V2 : compte d’abord, puis enfant.
 * Pas de compte → onboarding. Compte sans enfant → create-child. Sinon tabs.
 */
export default function Index() {
  const [hasChild, setHasChild] = useState(() => {
    hydrateTabScreensFromSqliteSync();
    return listLocalChildren().length > 0;
  });
  const [hasAccount, setHasAccount] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    void (async () => {
      const [accountOk, children] = await Promise.all([
        hasRealAuthAccount(),
        getChildren(),
      ]);
      setHasAccount(accountOk);
      setHasChild(children.length > 0);
      setIsChecking(false);
    })();
  }, []);

  if (isChecking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={THEME.accent} />
      </View>
    );
  }

  if (!hasAccount) {
    return <Redirect href="/onboarding" />;
  }
  if (!hasChild) {
    return <Redirect href="/create-child" />;
  }
  return <Redirect href="/(tabs)" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.bgScreen,
  },
});
