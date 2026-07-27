import { Alert } from 'react-native';
import type { Router } from 'expo-router';
import i18n from '@/lib/i18n';
import {
  FREE_TIER_LIMIT,
  FREE_TIER_VIDEO_LIMIT,
  FREE_TIER_VOICE_LIMIT,
} from '@/lib/limits';

/** Contextes paywall alignés sur `app/paywall.tsx`. */
export type FreeTierPaywallContext =
  | 'LIMIT_REACHED'
  | 'VIDEO_LIMIT_REACHED'
  | 'VOICE_LIMIT_REACHED'
  | 'GENERAL';

export type FreeTierLimitKind = 'memories' | 'videos' | 'voices';

type LimitCopy = {
  title: string;
  body: string;
  context: FreeTierPaywallContext;
};

function copyForKind(kind: FreeTierLimitKind): LimitCopy {
  switch (kind) {
    case 'videos':
      return {
        title: i18n.t('parent.freeTierLimit.videosTitle'),
        body: i18n.t('parent.freeTierLimit.videosBody', {
          count: FREE_TIER_VIDEO_LIMIT,
        }),
        context: 'VIDEO_LIMIT_REACHED',
      };
    case 'voices':
      return {
        title: i18n.t('parent.freeTierLimit.voicesTitle'),
        body: i18n.t('parent.freeTierLimit.voicesBody', {
          count: FREE_TIER_VOICE_LIMIT,
        }),
        context: 'VOICE_LIMIT_REACHED',
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

/**
 * Message explicite **avant** le paywall pour toute limite du plan gratuit.
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
  if (message === 'VOICE_LIMIT_REACHED') {
    promptFreeTierLimitThenPaywall({ ...opts, kind: 'voices' });
    return true;
  }
  if (message === 'LIMIT_REACHED') {
    promptFreeTierLimitThenPaywall({ ...opts, kind: 'memories' });
    return true;
  }
  return false;
}
