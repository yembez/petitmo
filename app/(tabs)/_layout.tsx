import { useEffect } from 'react';
import { DeviceEventEmitter, Easing } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useNavigation } from '@react-navigation/native';
import { TabTransitionProvider, useTabTransition } from '@/contexts/TabTransitionContext';
import { MemoryTextFontProvider } from '@/contexts/MemoryTextFontContext';
import PetitmoContextTabBar from '@/components/PetitmoContextTabBar';
import { THEME } from '@/constants/theme';
import { TAB_TRANSITION_DURATION_MS } from '@/constants/tabTransition';
import { PETITMO_SELECT_TAB, type AppTabName } from '@/services/selectAppTab';
import { hasRealAuthAccount, peekHasRealAuthAccount, isDeviceUserEmail, PETITMO_AUTH_SIGNED_OUT_EVENT, peekIntentionalSignedOut } from '@/lib/authAccount';
import { supabase } from '@/lib/supabase';
import { resetNavigationToOnboarding } from '@/utils/resetNavigationToOnboarding';

export default function TabLayout() {
  return (
    <MemoryTextFontProvider>
      <TabTransitionProvider>
        <TabLayoutInner />
      </TabTransitionProvider>
    </MemoryTextFontProvider>
  );
}

/** Écoute `selectAppTab` avec la nav **tabs** (pas le stack root). */
function TabSelectListener({
  navigation,
}: {
  navigation: any;
}) {
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      PETITMO_SELECT_TAB,
      (payload: { name?: AppTabName }) => {
        const name = payload?.name;
        if (name !== 'fil' && name !== 'index' && name !== 'favoris' && name !== 'livres') {
          return;
        }
        navigation.jumpTo(name);
      },
    );
    return () => sub.remove();
  }, [navigation]);
  return null;
}

/**
 * Sans compte produit, les onglets ne doivent jamais rester accessibles
 * (swipe-back post-logout → fil fantôme du compte précédent).
 */
function RequireRealAccountGate() {
  const router = useRouter();
  const navigation = useNavigation();

  useEffect(() => {
    let cancelled = false;

    const kickIfSignedOut = async () => {
      if (peekIntentionalSignedOut() || peekHasRealAuthAccount() === false) {
        if (!cancelled) resetNavigationToOnboarding(router, navigation);
        return;
      }
      const ok = await hasRealAuthAccount();
      if (!cancelled && !ok) {
        resetNavigationToOnboarding(router, navigation);
      }
    };

    void kickIfSignedOut();

    const subSignedOut = DeviceEventEmitter.addListener(PETITMO_AUTH_SIGNED_OUT_EVENT, () => {
      void kickIfSignedOut();
    });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email ?? '';
      if (!session?.user || isDeviceUserEmail(email)) {
        void kickIfSignedOut();
      }
    });

    return () => {
      cancelled = true;
      subSignedOut.remove();
      data.subscription.unsubscribe();
    };
  }, [navigation, router]);

  return null;
}

function TabLayoutInner() {
  const { setTabIndex } = useTabTransition();
  /** Libellés tab bar — police système (SF Pro sur iOS). */
  const tabLabelFontRegular = undefined;
  const tabLabelFontMedium = undefined;

  return (
    <Tabs
      screenListeners={{
        state: e => {
          const index = e.data.state?.index;
          if (typeof index === 'number') setTabIndex(index);
        },
      }}
      tabBar={props => (
        <>
          <RequireRealAccountGate />
          <TabSelectListener navigation={props.navigation} />
          <PetitmoContextTabBar
            {...props}
            tabLabelFontRegular={tabLabelFontRegular}
            tabLabelFontMedium={tabLabelFontMedium}
          />
        </>
      )}
      screenOptions={{
        headerShown: false,
        /** Garder Fil / Favoris montés : évite remontage + rechargement images après long séjour sur Capturer. */
        lazy: false,
        /**
         * `freezeOnBlur` gèle Reanimated + expo-video sur les onglets inactifs au 1er montage ;
         * au retour sur Fil / Favoris, zoom diaporama et autoplay vidéo ne repartaient plus.
         */
        freezeOnBlur: false,
        /**
         * Cross-fade natif (évite le cut sec). `detachInactiveScreens: false` limite
         * les écrans blancs connus avec `animation: 'fade'` + react-native-screens.
         */
        animation: 'fade',
        transitionSpec: {
          animation: 'timing',
          config: {
            duration: TAB_TRANSITION_DURATION_MS,
            easing: Easing.bezier(0.22, 0.61, 0.36, 1),
          },
        },
        detachInactiveScreens: false,
        sceneStyle: { backgroundColor: THEME.bg },
      }}>
      <Tabs.Screen name="fil" options={{ title: 'Journal' }} />
      <Tabs.Screen name="index" options={{ title: 'Capturer' }} />
      <Tabs.Screen name="favoris" options={{ title: 'Favoris' }} />
      <Tabs.Screen name="livres" options={{ title: 'Livres' }} />
    </Tabs>
  );
}
