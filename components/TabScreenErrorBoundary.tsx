import type { ReactNode } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Sentry } from '@/lib/sentry';
import { recordCaughtError } from '@/lib/diagnosticTrail';
import { reportTabPaint, type MainTabWatchName } from '@/lib/tabBlankWatchdog';
import { THEME } from '@/constants/theme';
import { emptyStateStyles } from '@/constants/emptyStateStyles';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { scale, verticalScale } from '@/utils/responsive';

function TabErrorFallback({
  tab,
  onRetry,
}: {
  tab: MainTabWatchName;
  onRetry: () => void;
}) {
  const { t } = useAppTranslation('common');
  return (
    <View style={styles.root}>
      <Text style={emptyStateStyles.title}>{t('tabs.error.title')}</Text>
      <Text style={[emptyStateStyles.subtitle, styles.sub]}>
        {t('tabs.error.subtitle')}
      </Text>
      <PetitmoPrimaryPressable style={styles.cta} onPress={onRetry} activeOpacity={0.85}>
        <Text style={petitmoCtaStyles.primaryText}>{t('tabs.error.retry')}</Text>
      </PetitmoPrimaryPressable>
      {__DEV__ ? <Text style={styles.devHint}>{tab}</Text> : null}
    </View>
  );
}

type Props = {
  tab: MainTabWatchName;
  children: ReactNode;
};

/** Boundary par onglet — crash de render → Sentry + CTA Réessayer (plus de blanc mort). */
export default function TabScreenErrorBoundary({ tab, children }: Props) {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <TabErrorFallback
          tab={tab}
          onRetry={() => {
            reportTabPaint({
              tab,
              focused: true,
              blank: false,
              reason: 'ok',
              detail: 'retry',
            });
            resetError();
          }}
        />
      )}
      onError={error => {
        recordCaughtError(`tab.${tab}.render`, error);
        reportTabPaint({
          tab,
          focused: true,
          blank: true,
          reason: 'error_boundary',
        });
      }}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bg,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(28),
  },
  sub: {
    marginTop: verticalScale(8),
    marginBottom: verticalScale(20),
  },
  cta: {
    minWidth: scale(160),
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(22),
  },
  devHint: {
    marginTop: verticalScale(16),
    fontSize: scale(11),
    color: THEME.textMuted,
  },
});
