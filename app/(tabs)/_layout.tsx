import { useFonts, DMSans_400Regular, DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import { Tabs } from 'expo-router';
import { TabTransitionProvider, useTabTransition } from '@/contexts/TabTransitionContext';
import { MemoryTextFontProvider } from '@/contexts/MemoryTextFontContext';
import PetitmoContextTabBar from '@/components/PetitmoContextTabBar';
import { THEME } from '@/constants/theme';

export default function TabLayout() {
  return (
    <MemoryTextFontProvider>
      <TabTransitionProvider>
        <TabLayoutInner />
      </TabTransitionProvider>
    </MemoryTextFontProvider>
  );
}

function TabLayoutInner() {
  const { setTabIndex } = useTabTransition();
  const [tabFontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
  });
  const tabLabelFontRegular = tabFontsLoaded ? 'DMSans_400Regular' : undefined;
  const tabLabelFontMedium = tabFontsLoaded ? 'DMSans_500Medium' : undefined;

  return (
    <Tabs
      screenListeners={{
        state: e => {
          const index = e.data.state?.index;
          if (typeof index === 'number') setTabIndex(index);
        },
      }}
      tabBar={props => (
        <PetitmoContextTabBar
          {...props}
          tabLabelFontRegular={tabLabelFontRegular}
          tabLabelFontMedium={tabLabelFontMedium}
        />
      )}
      screenOptions={{
        headerShown: false,
        /** Garder Fil / Favoris montés : évite remontage + rechargement images après long séjour sur Capturer. */
        lazy: false,
        detachInactiveScreens: false,
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
