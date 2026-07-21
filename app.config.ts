import type { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
  return {
    ...config,
    // ExpoConfig exige `name` (et souvent `slug`) non optionnels au niveau type.
    name: config.name ?? 'petitmo',
    slug: config.slug ?? 'petitmo',
    plugins: [...(config.plugins ?? []), 'expo-sqlite', 'expo-localization'],
    extra: {
      ...(config.extra ?? {}),
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      EXPO_PUBLIC_PRIVACY_POLICY_URL: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
      EXPO_PUBLIC_DEBUG_SUPABASE_EGRESS: process.env.EXPO_PUBLIC_DEBUG_SUPABASE_EGRESS,
      EXPO_PUBLIC_PDF_SERVER_URL: process.env.EXPO_PUBLIC_PDF_SERVER_URL,
      EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL: process.env.EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL,
    },
  };
};

