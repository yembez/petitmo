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
    ignoreErrors: [
      'Network request failed',
      'Failed to fetch',
      'NetworkError',
      'The Internet connection appears to be offline',
      'The network connection was lost',
    ],
    beforeSend(event, hint) {
      const err = hint?.originalException;
      const msg =
        (typeof err === 'string' ? err : err instanceof Error ? err.message : '') ||
        event.message ||
        event.exception?.values?.[0]?.value ||
        '';
      // Hors-ligne / avion : bruit, pas un bug produit.
      if (/network request failed|failed to fetch|networkerror|internet connection appears to be offline|network connection was lost/i.test(msg)) {
        return null;
      }
      return event;
    },
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

/** UUID compte seulement — jamais d’e-mail / nom. */
export function setPetitmoSentryUser(user: { id: string } | null): void {
  if (!isSentryEnabled()) return;
  if (!user?.id?.trim()) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id.trim() });
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

/**
 * Purge SQLite d’isolation (changement de compte / foreign).
 * Cause fréquente de « profil disparu » après Apple ≠ e-mail — doit être visible Sentry.
 */
export function captureAccountWorkspaceCleared(params: {
  reason: string;
  prevUserId?: string | null;
  nextUserId?: string | null;
  localChildrenBefore?: number;
}): string | null {
  if (!isSentryEnabled()) return null;
  const reason = (params.reason || 'unknown').trim().slice(0, 120);
  const err = new Error(`auth.workspace.cleared: ${reason}`);
  return Sentry.captureException(err, {
    level: 'warning',
    tags: {
      'app.errorScope': 'auth.workspace',
      'app.workspaceClear': reason.split(':')[0] || reason,
    },
    fingerprint: ['auth', 'workspace-cleared', reason.split(':')[0] || 'unknown'],
    extra: {
      reason,
      prevUserId: params.prevUserId ? String(params.prevUserId).slice(0, 8) : undefined,
      nextUserId: params.nextUserId ? String(params.nextUserId).slice(0, 8) : undefined,
      localChildrenBefore: params.localChildrenBefore ?? undefined,
    },
  });
}

/**
 * Hang / timeout sur un gate auth (Apple / login / finishAfterAuth).
 * Un await réseau sans throw = **aucun** event Sentry sans cet appel explicite.
 */
export function captureAuthGateTimeout(params: {
  gate: string;
  detail?: string;
}): string | null {
  if (!isSentryEnabled()) return null;
  const gate = (params.gate || 'unknown').trim().slice(0, 80);
  const detail = (params.detail ?? '').trim().slice(0, 200);
  const err = new Error(`auth.gate.timeout: ${gate}${detail ? ` — ${detail}` : ''}`);
  return Sentry.captureException(err, {
    level: 'error',
    tags: {
      'app.errorScope': 'auth.gate',
      'app.authGate': gate,
    },
    fingerprint: ['auth', 'gate-timeout', gate],
    extra: { gate, detail: detail || undefined },
  });
}

/**
 * Échec achat / restore Petitmo+ (hors annulation utilisatrice).
 * → issue Sentry (et mail fondateur si webhook issue configuré).
 */
export function capturePaywallPurchaseFailure(params: {
  kind: 'purchase' | 'restore';
  plan?: string;
  message: string;
  /** Snapshot StoreKit / offerings au moment du tap (pas de secrets). */
  diagnostic?: Record<string, unknown>;
}): string | null {
  if (!isSentryEnabled()) return null;
  const msg = (params.message || 'unknown').trim().slice(0, 280);
  const kind = params.kind;
  const plan = (params.plan ?? '').trim().slice(0, 24);
  const err = new Error(`paywall.${kind}.fail: ${msg}`);
  return Sentry.captureException(err, {
    level: 'error',
    tags: {
      'app.errorScope': `paywall.${kind}`,
      'app.paywallKind': kind,
      ...(plan ? { 'app.paywallPlan': plan } : {}),
    },
    fingerprint: ['paywall', kind, msg.slice(0, 80)],
    extra: { message: msg, plan: plan || undefined, diagnostic: params.diagnostic },
  });
}

/**
 * Smoke HITL (appui long version Espace parent).
 * Fingerprint unique à chaque envoi → nouvelle issue Sentry → webhook fondateur.
 */
export function captureSentrySmokeTest(): string | null {
  if (!isSentryEnabled()) return null;
  const stamp = new Date().toISOString();
  const err = new Error(`petitmo_sentry_smoke_hitl ${stamp}`);
  return Sentry.captureException(err, {
    level: 'error',
    tags: {
      'app.smokeTest': 'yes',
      'app.errorScope': 'capture.photo',
    },
    fingerprint: ['petitmo-sentry-smoke', stamp],
    extra: { purpose: 'hitl_draft_smoke', stamp },
  });
}

export { Sentry };
