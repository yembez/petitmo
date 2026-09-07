import { useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import * as Font from 'expo-font';
import { Tabs } from 'expo-router';
import { TabTransitionProvider, useTabTransition } from '@/contexts/TabTransitionContext';
import { MemoryTextFontProvider } from '@/contexts/MemoryTextFontContext';
import PetitmoContextTabBar from '@/components/PetitmoContextTabBar';
import { THEME } from '@/constants/theme';
import { PETITMO_SELECT_TAB, type AppTabName } from '@/services/selectAppTab';

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

function TabLayoutInner() {
  const { setTabIndex } = useTabTransition();
  const [tabFontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_700Bold,
  });
  const tabFontsReady =
    tabFontsLoaded ||
    (Font.isLoaded('DMSans_400Regular') &&
      Font.isLoaded('DMSans_500Medium') &&
      Font.isLoaded('DMSans_700Bold'));
  const tabLabelFontRegular = tabFontsReady ? 'DMSans_400Regular' : undefined;
  const tabLabelFontMedium = tabFontsReady ? 'DMSans_500Medium' : undefined;

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
         * `freezeOnBlur` gèle Reanimated + expo-av sur les onglets inactifs au 1er montage ;
         * au retour sur Fil / Favoris, zoom diaporama et autoplay vidéo ne repartaient plus.
         */
        freezeOnBlur: false,
        sceneStyle: { backgroundColor: THEME.bg },
      }}>
      <Tabs.Screen name="fil" options={{ title: 'Journal' }} />
      <Tabs.Screen name="index" options={{ title: 'Capturer' }} />
      <Tabs.Screen name="favoris" options={{ title: 'Favoris' }} />
      <Tabs.Screen name="livres" options={{ title: 'Livres' }} />
    </Tabs>
  );
}
