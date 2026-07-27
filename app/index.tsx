import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { THEME } from '@/constants/theme';
import { getChildren, refreshChildrenFromCloudInBackground } from '@/services/children';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';
import { hasRealAuthAccount, peekHasRealAuthAccount } from '@/lib/authAccount';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';

/**
 * Règle d'or V2 : compte d’abord, puis enfant.
 * Pas de compte → onboarding. Compte sans enfant → create-child. Sinon tabs.
 * Ne jamais démarrer sur un enfant SQLite d’un autre e-mail (hydratation scopée).
 * Local-first : si session réelle + SQLite déjà plein → redirect immédiat (cloud en fond).
 * Important : `lastRealAuthUserId` seul ≠ compte actif (reste après déconnexion pour reconnect).
 */
export default function Index() {
  const [hasChild, setHasChild] = useState(() => {
    if (!peekHasRealAuthAccount()) return false;
    hydrateTabScreensFromSqliteSync();
    const uid = peekLastRealAuthUserId();
    if (!uid) return false;
    return listLocalChildrenForUser(uid).length > 0;
  });
  const [hasAccount, setHasAccount] = useState(() => peekHasRealAuthAccount());
  const [isChecking, setIsChecking] = useState(() => {
    // Fast-path uniquement si mémoire session réelle + enfants locaux.
    return !(
      peekHasRealAuthAccount() &&
      peekLastRealAuthUserId() &&
      listLocalChildrenForUser(peekLastRealAuthUserId()!).length > 0
    );
  });

  useEffect(() => {
    void (async () => {
      const accountOk = await hasRealAuthAccount();
      setHasAccount(accountOk);
      if (!accountOk) {
        setHasChild(false);
        setIsChecking(false);
        return;
      }

      const uid = peekLastRealAuthUserId();
      const localKids = uid ? listLocalChildrenForUser(uid) : [];
      if (localKids.length > 0) {
        setHasChild(true);
        setIsChecking(false);
        refreshChildrenFromCloudInBackground();
        return;
      }

      // Cold : SQLite vide → pull cloud légitime avant redirect create-child vs tabs.
      const children = await getChildren();
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
    // Permissions avant create-child si pas encore vues (même cold start).
    return <Redirect href="/onboarding-permissions" />;
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
