import {
  useFonts,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';

/** Typo alignée écran paywall — formulaires famille / espace parent */
export function useDmSansFamilyFlowFonts() {
  const [loaded] = useFonts({
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  return {
    loaded,
    dm500: loaded ? 'DMSans_500Medium' : undefined,
    dm600: loaded ? 'DMSans_600SemiBold' : undefined,
    dm700: loaded ? 'DMSans_700Bold' : undefined,
  };
}
