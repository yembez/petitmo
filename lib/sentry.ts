import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';

let initialized = false;

function resolveDsn(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();
  if (fromEnv) return fromEnv;
  const extra = Constants.expoConfig?.extra as { EXPO_PUBLIC_SENTRY_DSN?: string } | undefined;
  return (extra?.EXPO_PUBLIC_SENTRY_DSN ?? '').trim();
}

/** `true` si Sentry est actif (DSN présent). */
export function isSentryEnabled(): boolean {
  return initialized && !!resolveDsn();
}

/**
 * Init une seule fois au boot. Sans DSN → no-op (dev local OK).
 * Tags : release / dist / OTA pour retrouver un bug bêta en 10 s.
 *
 * Crashs natifs (SIGABRT / TurboModule…) : `enableNative: true` (défaut SDK).
 * Les stacks natives restent lisibles si les dSYM / source maps sont uploadés
 * au build EAS (`SENTRY_AUTH_TOKEN` + org/project — voir OBSERVABILITY_BETA.md).
 */
export function initPetitmoSentry(): void {
  if (initialized) return;
  initialized = true;

  const dsn = resolveDsn();
  if (!dsn) {
    /** Toujours `init` (même disabled) pour que `Sentry.wrap` ne warn pas. */
    Sentry.init({ dsn: undefined, enabled: false });
    if (__DEV__) {
      console.info('[sentry] EXPO_PUBLIC_SENTRY_DSN absent — reporting désactivé');
    }
    return;
  }

  let updateId: string | undefined;
  let channel: string | undefined;
  try {
    updateId = Updates.updateId ?? undefined;
    channel = Updates.channel ?? undefined;
  } catch {
    /* ignore */
  }

  const release =
    Constants.expoConfig?.version != null
      ? `petitmo@${Constants.expoConfig.version}`
      : undefined;

  Sentry.init({
    dsn,
    enabled: true,
    /** Crashs ObjC / TurboModule / SIGABRT — indispensable pour le diagnostic TestFlight. */
    enableNative: true,
    enableNativeCrashHandling: true,
    enableAutoSessionTracking: true,
    attachStacktrace: true,
    sendDefaultPii: false,
    /** Perf légère — pas de session replay. */
    tracesSampleRate: 0.15,
    environment: channel || (__DEV__ ? 'development' : 'production'),
    release,
    dist: Constants.nativeBuildVersion ?? undefined,
  });

  Sentry.setTag('app.channel', channel || 'unknown');
  if (updateId) Sentry.setTag('app.updateId', updateId);
  Sentry.setTag('app.otaEmbedded', Updates.isEmbeddedLaunch ? 'yes' : 'no');
  if (Constants.nativeBuildVersion) {
    Sentry.setTag('app.build', String(Constants.nativeBuildVersion));
  }

  if (__DEV__) {
    console.info('[sentry] reporting actif', { release, dist: Constants.nativeBuildVersion });
  }
}

export async function enrichSentryUserContext(tags: {
  tier?: string;
  userMode?: string;
}): Promise<void> {
  if (!isSentryEnabled()) return;
  if (tags.tier) Sentry.setTag('app.tier', tags.tier);
  if (tags.userMode) Sentry.setTag('app.userMode', tags.userMode);
}

/** Signalement manuel → event Sentry + id pour le coller dans le mail. */
export function captureUserBugReport(message: string, extra: Record<string, unknown>): string | null {
  if (!isSentryEnabled()) return null;
  return Sentry.captureMessage(message, {
    level: 'info',
    tags: { 'app.source': 'user_report' },
    extra,
  });
}

export { Sentry };
