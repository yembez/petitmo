import { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { THEME } from '@/constants/theme';
import { getChildren } from '@/services/children';

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
