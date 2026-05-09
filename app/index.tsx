import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { THEME } from '@/constants/theme';
import { getChildren } from '@/services/children';

/**
 * Règle d'or (cf. AGENTS.md / docs/specs/architecture-locale-cloud.md) :
 * la décision de redirection initiale ne doit dépendre QUE du local
 * (SQLite) — jamais d'un check Supabase. Les deux modes (gratuit / Petitmo+)
 * passent par `/onboarding` s'il n'y a pas encore d'enfant local ; l'écran
 * d'accueil propose ensuite "Commencer" (gratuit) ou "J'ai un compte
 * Petitmo+" (restauration cloud).
 */
export default function Index() {
  const [isChecking, setIsChecking] = useState(true);
  const [hasChild, setHasChild] = useState(false);

  useEffect(() => {
    const checkChild = async () => {
      const children = await getChildren();
      setHasChild(children.length > 0);
      setIsChecking(false);
    };

    checkChild();
  }, []);

  if (isChecking) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color={THEME.accent} />
      </View>
    );
  }

  return <Redirect href={hasChild ? '/(tabs)' : '/onboarding'} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.bgScreen,
  },
});
