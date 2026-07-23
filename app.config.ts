import type { ExpoConfig, ConfigContext } from 'expo/config';

/** `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc` */
function iosUrlSchemeFromGoogleIosClientId(iosClientId: string): string | undefined {
  const m = iosClientId
    .trim()
    .match(/^([0-9]+-[a-zA-Z0-9]+)\.apps\.googleusercontent\.com$/);
  if (!m) return undefined;
  return `com.googleusercontent.apps.${m[1]}`;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const googleIosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim();
  const iosUrlScheme = googleIosClientId
    ? iosUrlSchemeFromGoogleIosClientId(googleIosClientId)
    : undefined;

  const plugins = [
    ...(config.plugins ?? []),
    'expo-sqlite',
    'expo-localization',
    '@sentry/react-native',
  ] as NonNullable<ExpoConfig['plugins']>;

  if (iosUrlScheme) {
    plugins.push([
      '@react-native-google-signin/google-signin',
      { iosUrlScheme },
    ]);
  }

  return {
    ...config,
    name: config.name ?? 'petitmo',
    slug: config.slug ?? 'petitmo',
    plugins,
    extra: {
      ...(config.extra ?? {}),
      EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
      EXPO_PUBLIC_SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
      EXPO_PUBLIC_PRIVACY_POLICY_URL: process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL,
      EXPO_PUBLIC_DEBUG_SUPABASE_EGRESS: process.env.EXPO_PUBLIC_DEBUG_SUPABASE_EGRESS,
      EXPO_PUBLIC_PDF_SERVER_URL: process.env.EXPO_PUBLIC_PDF_SERVER_URL,
      EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL: process.env.EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL,
      EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    },
  };
};
