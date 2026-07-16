import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';
import { getPendingBookOrderPdfPayload, clearPendingBookOrderPdfPayload } from '@/lib/pendingBookOrderPdf';
import {
  clearPendingExportUploadTicket,
  ensureFreshExportUploadTicket,
  getPendingExportUploadTicketRecord,
  setPendingExportUploadTicket,
} from '@/lib/pendingExportUploadTicket';
import type { Memory } from '@/types/local';
import { collectMemoriesFromPagesForPdf } from '@/services/bookPdfServer';
import {
  enqueueGuestRawUpload,
  getPendingGuestRawUploadsCountForKeys,
  getPendingGuestRawUploadsCount,
  getPendingGuestRawUploadLastErrors,
  processPendingGuestRawUploads,
  refreshAllPendingGuestRawUploadTickets,
} from '@/services/pendingRawGuestUploads';

const HARD_TIMEOUT_MS = 3 * 60_000;
const SLOW_HINT_MS = 45_000;
const STUCK_AFTER_PARTIAL_MS = 90_000;

function parsePriceEuros(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string') return 0;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function localUriForAv(m: Memory): string {
  const fromLocal = (m.local_original_path ?? m.local_media_path ?? '').trim();
  if (fromLocal) return fromLocal;
  const fallback = (m.media_url ?? m.edited_media_url ?? '').trim();
  if (fallback.toLowerCase().startsWith('file:')) return fallback;
  return '';
}

function mimeTypeForAudio(): string {
  return 'audio/mp4';
}

function mimeTypeForVideo(uri: string): string {
  const u = uri.toLowerCase();
  if (u.endsWith('.mov') || u.includes('.mov?')) return 'video/quicktime';
  return 'video/mp4';
}

export default function BookFinalizeMediaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    exportTicket?: string | string[];
    priceEuros?: string;
    email?: string;
    marketingOptIn?: string;
    exportMode?: string;
  }>();

  const exportTicketFromParams = useMemo(() => {
    const raw = params.exportTicket;
    const s = Array.isArray(raw) ? raw[0] : raw;
    return typeof s === 'string' ? s.trim() : '';
  }, [params.exportTicket]);
  const priceEuros = useMemo(() => parsePriceEuros(params.priceEuros), [params.priceEuros]);
  const email = typeof params.email === 'string' ? params.email.trim() : '';
  const marketingOptIn = params.marketingOptIn === '1';

  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'finalizing' | 'done' | 'needs_network'>('finalizing');
  const [progressPct, setProgressPct] = useState(0);
  const [slowHint, setSlowHint] = useState(false);
  const [statusLine, setStatusLine] = useState('');
  const cancelledRef = useRef(false);

  const targetKeysRef = useRef<string[]>([]);
  const totalRef = useRef<number>(0);
  const resolvedTicketRef = useRef<string>('');

  const goToConfirmation = useCallback(() => {
    void clearPendingBookOrderPdfPayload();
    void clearPendingExportUploadTicket();
    router.replace({
      pathname: '/book-order-confirmation',
      params: {
        exportMode: (params.exportMode === 'pdf' ? 'pdf' : 'print') as string,
        priceEuros: String(priceEuros),
        email,
        marketingOptIn: marketingOptIn ? '1' : '0',
      },
    });
  }, [email, marketingOptIn, params.exportMode, priceEuros, router]);

  const startFinalization = useCallback(async () => {
    cancelledRef.current = false;
    const emailNorm = email.trim().toLowerCase();
    let exportTicket = '';
    try {
      exportTicket =
        (await ensureFreshExportUploadTicket({ email: emailNorm }))?.trim() ?? '';
    } catch (e) {
      if (__DEV__) console.warn('[book-finalize-media] ensureFreshExportUploadTicket', e);
    }
    if (!exportTicket) {
      const rec = await getPendingExportUploadTicketRecord();
      exportTicket = rec?.ticket?.trim() ?? exportTicketFromParams;
    }
    resolvedTicketRef.current = exportTicket;
    if (!exportTicket) {
      setPhase('needs_network');
      setStatusLine('Jeton d’export manquant ou expiré. Relance la commande du livre.');
      return;
    }
    // Ticket frais sur toute la file (évite un JWT expiré / tronqué resté en AsyncStorage).
    await refreshAllPendingGuestRawUploadTickets(exportTicket);

    setPhase('finalizing');
    setSlowHint(false);
    setStatusLine('');
    setProgressPct(0);

    const payload = await getPendingBookOrderPdfPayload();
    const memories = payload
      ? collectMemoriesFromPagesForPdf(payload.pages, payload.localEdits ?? {})
      : [];
    const av = memories.filter(m => m.type === 'voice' || m.type === 'video');

    const tasks: Array<Promise<void>> = [];
    const keys: string[] = [];

    for (const m of av) {
      const kind = m.type === 'voice' ? 'audio' : 'video';
      const local = localUriForAv(m);
      if (!local) continue;
      const key = `${kind}:${m.id}`;
      keys.push(key);
      tasks.push(
        enqueueGuestRawUpload({
          pdfTicket: exportTicket,
          kind,
          memoryId: m.id,
          localUri: local,
          mimeType: kind === 'video' ? mimeTypeForVideo(local) : mimeTypeForAudio(),
          policy: 'finalize_only',
        }),
      );
    }

    targetKeysRef.current = Array.from(new Set(keys));

    // Payload déjà vidé : traiter la file persistée par generateBookPdfWithExportTicket.
    if (targetKeysRef.current.length === 0) {
      const pendingCount = await getPendingGuestRawUploadsCount();
      if (pendingCount === 0) {
        setProgressPct(100);
        setPhase('done');
        return;
      }
      totalRef.current = pendingCount;
    } else {
      totalRef.current = targetKeysRef.current.length;
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }

    const startedAt = Date.now();
    let lastProgressAt = startedAt;
    let lastDone = 0;
    const slowTimer = setTimeout(() => setSlowHint(true), SLOW_HINT_MS);
    try {
      while (!cancelledRef.current) {
        setStatusLine('Envoi des médias…');
        await processPendingGuestRawUploads({ force: true });
        const left =
          targetKeysRef.current.length > 0
            ? await getPendingGuestRawUploadsCountForKeys(targetKeysRef.current)
            : await getPendingGuestRawUploadsCount();
        const total = totalRef.current || 1;
        const done = Math.max(0, Math.min(total, total - left));
        setProgressPct(Math.round((done / total) * 100));

        if (done > lastDone) {
          lastDone = done;
          lastProgressAt = Date.now();
        }

        if (left <= 0) break;

        const elapsed = Date.now() - startedAt;
        const stalled = Date.now() - lastProgressAt > STUCK_AFTER_PARTIAL_MS;

        if (elapsed > HARD_TIMEOUT_MS || (elapsed > 60_000 && stalled)) {
          const errs = await getPendingGuestRawUploadLastErrors(
            targetKeysRef.current.length > 0 ? targetKeysRef.current : undefined,
          );
          if (__DEV__ && errs.length > 0) {
            console.warn('[book-finalize-media] timeout / stall', errs);
          }
          setStatusLine(
            errs[0]?.lastError
              ? `Dernière erreur : ${errs[0].lastError.slice(0, 120)}`
              : 'La connexion semble insuffisante pour terminer.',
          );
          setPhase('needs_network');
          return;
        }

        const errs = await getPendingGuestRawUploadLastErrors(
          targetKeysRef.current.length > 0 ? targetKeysRef.current : undefined,
        );
        const abandoned = errs.filter(e => e.attempts >= 6);
        if (abandoned.length > 0 && abandoned.length >= left) {
          setStatusLine(abandoned[0]?.lastError?.slice(0, 120) || 'Échec upload médias.');
          setPhase('needs_network');
          return;
        }

        await new Promise(r => setTimeout(r, 600));
      }

      if (cancelledRef.current) return;

      setProgressPct(100);
      setPhase('done');
    } finally {
      clearTimeout(slowTimer);
    }
  }, [email, exportTicketFromParams]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await startFinalization();
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [startFinalization]);

  const onRetry = useCallback(() => {
    void startFinalization();
  }, [startFinalization]);

  const onLater = useCallback(() => {
    // UX: reprise silencieuse au prochain lancement pour les items `auto` ;
    // finalize_only reste en file jusqu’à un nouvel essai / prochain parcours.
    goToConfirmation();
  }, [goToConfirmation]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + scale(24), paddingBottom: insets.bottom + scale(24) }]}>
      <View style={styles.card}>
        {phase === 'done' ? (
          <>
            <Text style={styles.title}>Tout est prêt ❤️</Text>
            <Text style={styles.sub}>Votre commande est confirmée. Nous préparons maintenant votre livre.</Text>
            <Pressable style={styles.cta} onPress={goToConfirmation} hitSlop={10}>
              <Text style={styles.ctaText}>Parfait</Text>
            </Pressable>
          </>
        ) : phase === 'needs_network' ? (
          <>
            <Text style={styles.title}>Petite pause ❤️</Text>
            <Text style={styles.sub}>
              Nous avons besoin d’une meilleure connexion pour terminer les audios et vidéos (QR) de votre livre.
            </Text>
            {statusLine ? <Text style={styles.errLine}>{statusLine}</Text> : null}
            <Pressable style={styles.cta} onPress={onRetry} hitSlop={10}>
              <Text style={styles.ctaText}>Réessayer</Text>
            </Pressable>
            <Pressable onPress={onLater} hitSlop={10} style={styles.secondaryWrap}>
              <Text style={styles.secondaryText}>Continuer sans attendre</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>Dernière étape ❤️</Text>
            <Text style={styles.sub}>Nous sécurisons les audios et vidéos (QR) de votre livre.</Text>
            <Text style={styles.sub2}>Gardez cette fenêtre ouverte quelques instants.</Text>

            <View
              style={styles.progressWrap}
              accessibilityRole="progressbar"
              accessibilityValue={{ now: progressPct, min: 0, max: 100 }}
            >
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
            <Text style={styles.progressLabel}>{progressPct}%</Text>

            {statusLine ? <Text style={styles.statusLine}>{statusLine}</Text> : null}

            {slowHint ? (
              <>
                <Text style={styles.slowHint}>
                  Cela prend plus longtemps que prévu (gros fichier ou réseau). Tu peux continuer — on
                  réessaiera plus tard.
                </Text>
                <Pressable onPress={onLater} hitSlop={10} style={styles.secondaryWrap}>
                  <Text style={styles.secondaryText}>Continuer sans attendre</Text>
                </Pressable>
              </>
            ) : (
              <Text style={styles.hint}>Cela peut prendre jusqu’à une minute selon votre connexion.</Text>
            )}

            {loading ? (
              <View style={styles.spinnerRow}>
                <ActivityIndicator color={THEME.brandCtaOrange} />
              </View>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: THEME.bgScreen, paddingHorizontal: scale(24) },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: THEME.surfaceCard,
    borderRadius: scale(18),
    padding: scale(20),
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2,
  },
  title: { fontSize: scale(24), lineHeight: scale(30), textAlign: 'center', color: THEME.textPrimary, marginBottom: scale(10) },
  sub: { fontSize: scale(16), lineHeight: scale(24), textAlign: 'center', color: THEME.textPrimary, marginBottom: scale(8) },
  sub2: { fontSize: scale(15), lineHeight: scale(22), textAlign: 'center', color: THEME.textMuted, marginBottom: scale(18) },
  progressWrap: {
    height: scale(10),
    borderRadius: scale(999),
    backgroundColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
    marginTop: scale(6),
  },
  progressFill: {
    height: '100%',
    backgroundColor: THEME.brandCtaOrange,
    borderRadius: scale(999),
  },
  progressLabel: { marginTop: scale(10), textAlign: 'center', color: THEME.textMuted, fontSize: scale(14) },
  statusLine: {
    marginTop: scale(8),
    textAlign: 'center',
    color: THEME.textMuted,
    fontSize: scale(12),
    lineHeight: scale(16),
  },
  errLine: {
    marginTop: scale(8),
    marginBottom: scale(4),
    textAlign: 'center',
    color: '#B91C1C',
    fontSize: scale(13),
    lineHeight: scale(18),
  },
  hint: { marginTop: scale(14), textAlign: 'center', color: THEME.textMuted, fontSize: scale(14), lineHeight: scale(20) },
  slowHint: { marginTop: scale(14), textAlign: 'center', color: THEME.textMuted, fontSize: scale(14), lineHeight: scale(20) },
  spinnerRow: { marginTop: scale(14), alignItems: 'center' },
  cta: {
    marginTop: scale(18),
    backgroundColor: THEME.brandCtaOrange,
    paddingVertical: scale(14),
    borderRadius: scale(12),
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: scale(16), fontWeight: '600' },
  secondaryWrap: { marginTop: scale(14), alignItems: 'center' },
  secondaryText: { color: THEME.textMuted, fontSize: scale(15) },
});
