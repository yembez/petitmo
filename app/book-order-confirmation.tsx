import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '@/constants/theme';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { scale } from '@/utils/responsive';
import { setCrmMarketingOptInForEmail } from '@/services/crmEdge';
import {
  clearBookOrderResultPdfUri,
  getBookOrderResultPdfUri,
} from '@/lib/pendingBookOrderPdf';
import { shareBookPdf } from '@/services/bookPdf';
import { finishPrintStashAndKickIfNeeded } from '@/services/finishPrintAfterPaid';
import { printBreadcrumb, printCaptureMessage } from '@/lib/printFlowSentry';
import { useAppTranslation } from '@/hooks/useAppTranslation';

type ExportModeParam = 'pdf' | 'print';

function parseMode(raw: string | string[] | undefined): ExportModeParam {
  if (raw === 'pdf' || (Array.isArray(raw) && raw[0] === 'pdf')) return 'pdf';
  return 'print';
}

function parsePriceEuros(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string') return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function formatEuros(e: number): string {
  return `${e.toFixed(2).replace('.', ',')}€`;
}

export default function BookOrderConfirmationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    exportMode?: string;
    priceEuros?: string;
    email?: string;
    marketingOptIn?: string;
  }>();

  const exportMode = useMemo(() => parseMode(params.exportMode), [params.exportMode]);
  const priceEuros = useMemo(() => parsePriceEuros(params.priceEuros), [params.priceEuros]);
  const email = typeof params.email === 'string' ? params.email.trim() : '';
  const marketingFromForm = params.marketingOptIn === '1';

  const { t } = useAppTranslation('common');
  const [optInLoading, setOptInLoading] = useState(false);
  const [optInDone, setOptInDone] = useState(false);
  const [resultPdfUri, setResultPdfUri] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const uri = await getBookOrderResultPdfUri();
      setResultPdfUri(uri);
    })();
  }, []);

  // Filet unique : kick 202 si pending paid encore là (webhook raté / kill app).
  // Ne poll **pas** Gelato — retries serveur.
  useEffect(() => {
    if (exportMode !== 'print') return;
    void (async () => {
      printBreadcrumb('print.confirmation.resume_finish');
      const result = await finishPrintStashAndKickIfNeeded();
      printBreadcrumb('print.confirmation.resume_result', { result });
      if (result === 'error' || result === 'missing_payload') {
        printCaptureMessage(
          'print.confirmation',
          `confirmation screen finish=${result}`,
          'warning',
        );
      }
    })();
  }, [exportMode]);

  const onConfirmMarketing = useCallback(async () => {
    if (!email) return;
    setOptInLoading(true);
    try {
      await setCrmMarketingOptInForEmail(email);
      setOptInDone(true);
    } catch {
      /* silencieux : l’utilisateur pourra retenter plus tard côté CRM */
    } finally {
      setOptInLoading(false);
    }
  }, [email]);

  const onNoMarketing = useCallback(() => {
    setOptInDone(true);
  }, []);

  const onBackMemories = useCallback(() => {
    void clearBookOrderResultPdfUri();
    router.replace('/(tabs)/fil');
  }, [router]);

  const onSharePdf = useCallback(() => {
    if (resultPdfUri) void shareBookPdf(resultPdfUri);
  }, [resultPdfUri]);

  const showMarketingBlock = !marketingFromForm && !optInDone;
  const subtitle =
    exportMode === 'print'
      ? email
        ? t('bookOrder.confirmationPrintBodyEmail', { email })
        : t('bookOrder.confirmationPrintBody')
      : resultPdfUri
        ? t('bookOrder.confirmationPdfReady')
        : t('bookOrder.confirmationPdfPending');

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        styles.scroll,
        { paddingTop: insets.top + scale(32), paddingBottom: insets.bottom + scale(32) },
      ]}
    >
      <Text style={styles.checkMark}>✓</Text>
      <Text
        style={styles.title}
        accessibilityRole="header"
      >
        Ta commande est confirmée !
      </Text>
      <Text style={styles.sub}>{subtitle}</Text>

      {resultPdfUri ? (
        <PetitmoPrimaryPressable
          style={styles.terracottaCta}
          onPress={onSharePdf}
          disabled={!resultPdfUri}
        >
          <Text style={styles.terracottaCtaText}>
            {exportMode === 'print' ? 'Ouvrir le PDF impression' : 'Partager le PDF'}
          </Text>
        </PetitmoPrimaryPressable>
      ) : null}

      <View style={styles.recap}>
        <Text style={styles.recapLine}>
          <Text style={styles.recapLabel}>Type : </Text>
          {exportMode === 'print' ? 'Livre imprimé' : 'PDF numérique'}
        </Text>
        <Text style={styles.recapLine}>
          <Text style={styles.recapLabel}>Prix payé : </Text>
          {formatEuros(priceEuros)}
        </Text>
        {email ? (
          <Text style={styles.recapLine}>
            <Text style={styles.recapLabel}>Email de confirmation : </Text>
            {email}
          </Text>
        ) : null}
      </View>

      <View style={styles.sep} />

      {showMarketingBlock ? (
        <View style={styles.marketingBlock}>
          <Text style={styles.marketingQuestion}>
            Tu veux recevoir nos conseils pour capturer encore plus de souvenirs ?
          </Text>
          <PetitmoPrimaryPressable
            style={styles.terracottaCta}
            onPress={() => void onConfirmMarketing()}
            disabled={optInLoading}
          >
            {optInLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.terracottaCtaText}>
                Oui, j'adorerais
              </Text>
            )}
          </PetitmoPrimaryPressable>
          <Pressable onPress={onNoMarketing} hitSlop={12} style={styles.mutedLinkWrap}>
            <Text style={styles.mutedLink}>Non merci</Text>
          </Pressable>
        </View>
      ) : null}

      {showMarketingBlock ? <View style={styles.sep} /> : null}

      <Pressable style={styles.secondaryCta} onPress={onBackMemories} hitSlop={8}>
        <Text style={styles.secondaryCtaText}>
          Retour à mes souvenirs
        </Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: THEME.bgScreen },
  scroll: { paddingHorizontal: scale(24), maxWidth: 480, width: '100%', alignSelf: 'center' },
  checkMark: {
    fontSize: scale(56),
    lineHeight: scale(60),
    textAlign: 'center',
    color: THEME.brandCtaOrange,
    marginBottom: scale(12),
  },
  // Typo système (SF sur iOS) — plus moderne que la serif/DM Sans sur cet écran.
  title: {
    fontSize: scale(26),
    lineHeight: scale(32),
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
    color: THEME.textPrimary,
    marginBottom: scale(12),
  },
  sub: {
    fontSize: scale(16),
    lineHeight: scale(24),
    textAlign: 'center',
    color: THEME.textMuted,
    marginBottom: scale(24),
  },
  recap: { marginBottom: scale(8) },
  recapLine: { fontSize: scale(15), color: THEME.textPrimary, marginBottom: scale(6) },
  recapLabel: { color: THEME.textMuted },
  sep: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginVertical: scale(20),
  },
  marketingBlock: { gap: scale(14) },
  marketingQuestion: {
    fontSize: scale(16),
    lineHeight: scale(24),
    textAlign: 'center',
    color: THEME.textPrimary,
  },
  terracottaCta: {
    paddingVertical: scale(14),
    borderRadius: scale(12),
    alignItems: 'center',
  },
  terracottaCtaText: { color: THEME.captureScreenCtaForeground, fontSize: scale(16), fontWeight: '600' },
  mutedLinkWrap: { alignSelf: 'center', paddingVertical: scale(4) },
  mutedLink: { fontSize: scale(15), color: THEME.textSecondary },
  secondaryCta: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    paddingVertical: scale(14),
    borderRadius: scale(12),
    alignItems: 'center',
  },
  secondaryCtaText: { fontSize: scale(16), fontWeight: '600', color: THEME.textPrimary },
});
