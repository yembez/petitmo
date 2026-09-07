import {
  useFonts,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import * as Font from 'expo-font';

/** Typo alignée écran paywall — formulaires famille / espace parent */
export function useDmSansFamilyFlowFonts() {
  const [loaded] = useFonts({
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  const ready =
    loaded ||
    (Font.isLoaded('DMSans_500Medium') &&
      Font.isLoaded('DMSans_600SemiBold') &&
      Font.isLoaded('DMSans_700Bold'));

  return {
    loaded: ready,
    dm500: ready ? 'DMSans_500Medium' : undefined,
    dm600: ready ? 'DMSans_600SemiBold' : undefined,
    dm700: ready ? 'DMSans_700Bold' : undefined,
  };
}
