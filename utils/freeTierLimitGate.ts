import { Alert } from 'react-native';
import type { Router } from 'expo-router';
import i18n from '@/lib/i18n';
import {
  FREE_TIER_LIMIT,
  FREE_TIER_VIDEO_LIMIT,
  type LimitCheck,
} from '@/lib/limits';

/** Contextes paywall alignés sur `app/paywall.tsx`. */
export type FreeTierPaywallContext =
  | 'LIMIT_REACHED'
  | 'VIDEO_LIMIT_REACHED'
  | 'EX_SUBSCRIBER'
  | 'GENERAL';

export type FreeTierLimitKind = 'memories' | 'videos' | 'capture_locked';

type LimitCopy = {
  title: string;
  body: string;
  context: FreeTierPaywallContext;
};

function copyForKind(kind: FreeTierLimitKind): LimitCopy {
  switch (kind) {
    case 'capture_locked':
      return {
        title: i18n.t('parent.freeTierLimit.captureLockedTitle'),
        body: i18n.t('parent.freeTierLimit.captureLockedBody'),
        context: 'EX_SUBSCRIBER',
      };
    case 'videos':
      return {
        title: i18n.t('parent.freeTierLimit.videosTitle'),
        body: i18n.t('parent.freeTierLimit.videosBody', {
          count: FREE_TIER_VIDEO_LIMIT,
        }),
        context: 'VIDEO_LIMIT_REACHED',
      };
    case 'memories':
    default:
      return {
        title: i18n.t('parent.freeTierLimit.memoriesTitle'),
        body: i18n.t('parent.freeTierLimit.memoriesBody', {
          count: FREE_TIER_LIMIT,
        }),
        context: 'LIMIT_REACHED',
      };
  }
}

/** Mappe un `LimitCheck` bloquant → kind d’alerte. */
export function freeTierLimitKindFromCheck(check: LimitCheck): FreeTierLimitKind {
  if (check.reason === 'capture_locked') return 'capture_locked';
  return 'memories';
}

/**
 * Message explicite **avant** le paywall pour toute limite du plan gratuit / ex-paid.
 * Bouton secondaire = rester ; principal = ouvrir le paywall.
 */
export function promptFreeTierLimitThenPaywall(opts: {
  kind: FreeTierLimitKind;
  router: Pick<Router, 'push' | 'replace'>;
  /** Défaut `push`. */
  replace?: boolean;
  returnTo?: string;
  onDismiss?: () => void;
}): void {
  const { title, body, context } = copyForKind(opts.kind);
  const goPaywall = () => {
    const params: Record<string, string> = { context };
    if (opts.returnTo?.trim()) params.returnTo = opts.returnTo.trim();
    if (opts.replace) {
      opts.router.replace({ pathname: '/paywall', params });
    } else {
      opts.router.push({ pathname: '/paywall', params });
    }
  };

  Alert.alert(title, body, [
    {
      text: i18n.t('parent.freeTierLimit.later'),
      style: 'cancel',
      onPress: () => {
        opts.onDismiss?.();
        /** Repli fil : ne pas laisser l’écran Importer / Capturer derrière l’Alert. */
        if (opts.returnTo === 'fil') {
          opts.router.replace('/(tabs)/fil');
        }
      },
    },
    {
      text: i18n.t('parent.freeTierLimit.ctaPlus'),
      onPress: goPaywall,
    },
  ]);
}

/** Mappe une erreur métier upload → kind + prompt. */
export function promptFreeTierLimitFromError(
  message: string,
  opts: Omit<Parameters<typeof promptFreeTierLimitThenPaywall>[0], 'kind'>,
): boolean {
  if (message === 'VIDEO_LIMIT_REACHED') {
    promptFreeTierLimitThenPaywall({ ...opts, kind: 'videos' });
    return true;
  }
  if (message === 'CAPTURE_LOCKED') {
    promptFreeTierLimitThenPaywall({ ...opts, kind: 'capture_locked' });
    return true;
  }
  if (message === 'LIMIT_REACHED') {
    promptFreeTierLimitThenPaywall({ ...opts, kind: 'memories' });
    return true;
  }
  return false;
}
