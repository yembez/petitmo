import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';
import { getPendingBookOrderPdfPayload } from '@/lib/pendingBookOrderPdf';
import type { Memory } from '@/types/local';
import { collectMemoriesFromPagesForPdf } from '@/services/bookPdfServer';
import {
  enqueueGuestRawUpload,
  getPendingGuestRawUploadsCountForKeys,
  processPendingGuestRawUploads,
} from '@/services/pendingRawGuestUploads';

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

export default function BookFinalizeMediaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    exportTicket?: string;
    priceEuros?: string;
    email?: string;
    marketingOptIn?: string;
    exportMode?: string;
  }>();

  const exportTicket = typeof params.exportTicket === 'string' ? params.exportTicket.trim() : '';
  const priceEuros = useMemo(() => parsePriceEuros(params.priceEuros), [params.priceEuros]);
  const email = typeof params.email === 'string' ? params.email.trim() : '';
  const marketingOptIn = params.marketingOptIn === '1';

  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<'finalizing' | 'done' | 'needs_network'>('finalizing');
  const [progressPct, setProgressPct] = useState(0);
  const [slowHint, setSlowHint] = useState(false);

  const targetKeysRef = useRef<string[]>([]);
  const totalRef = useRef<number>(0);

  const goToConfirmation = useCallback(() => {
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
    if (!exportTicket) {
      setPhase('needs_network');
      return;
    }
    setPhase('finalizing');
    setSlowHint(false);

    const payload = await getPendingBookOrderPdfPayload();
    if (!payload) {
      // Rien à finaliser : on n’empêche pas la confirmation.
      setPhase('done');
      return;
    }

    const memories = collectMemoriesFromPagesForPdf(payload.pages, payload.localEdits ?? {});
    // Plan gratuit : QR médias = audio uniquement
    const av = memories.filter(m => m.type === 'voice');

    const tasks: Array<Promise<void>> = [];
    const keys: string[] = [];

    for (const m of av) {
      const kind = 'audio';
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
          mimeType: mimeTypeForAudio(),
          policy: 'finalize_only',
        })
      );
    }

    targetKeysRef.current = Array.from(new Set(keys));
    totalRef.current = targetKeysRef.current.length;

    // Rien à faire → terminé.
    if (totalRef.current === 0) {
      setProgressPct(100);
      setPhase('done');
      return;
    }

    await Promise.all(tasks);

    const startedAt = Date.now();
    const slowTimer = setTimeout(() => setSlowHint(true), 90_000);
    try {
      // Boucle jusqu’à ce que tous les keys ciblés aient disparu de la queue.
      // On force ici car c’est une étape “fenêtre ouverte”.
      while (true) {
        await processPendingGuestRawUploads({ force: true });
        const left = await getPendingGuestRawUploadsCountForKeys(targetKeysRef.current);
        const total = totalRef.current || 1;
        const done = Math.max(0, Math.min(total, total - left));
        setProgressPct(Math.round((done / total) * 100));

        if (left <= 0) break;

        // Si ça dépasse ~2min et qu’on n’avance pas, on propose “pause”.
        if (Date.now() - startedAt > 120_000 && done === 0) {
          setPhase('needs_network');
          return;
        }
        await new Promise(r => setTimeout(r, 800));
      }

      setProgressPct(100);
      setPhase('done');
    } finally {
      clearTimeout(slowTimer);
    }
  }, [exportTicket]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await startFinalization();
      } finally {
        setLoading(false);
      }
    })();
  }, [startFinalization]);

  const onRetry = useCallback(() => {
    void startFinalization();
  }, [startFinalization]);

  const onLater = useCallback(() => {
    // UX: on laisse la reprise silencieuse au prochain lancement (queue persistée).
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
              Nous avons besoin d’une meilleure connexion pour terminer votre livre.
            </Text>
            <Pressable style={styles.cta} onPress={onRetry} hitSlop={10}>
              <Text style={styles.ctaText}>Réessayer</Text>
            </Pressable>
            <Pressable onPress={onLater} hitSlop={10} style={styles.secondaryWrap}>
              <Text style={styles.secondaryText}>Plus tard</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.title}>Dernière étape ❤️</Text>
            <Text style={styles.sub}>Nous sécurisons les souvenirs audio de votre livre.</Text>
            <Text style={styles.sub2}>Gardez cette fenêtre ouverte quelques instants.</Text>

            <View style={styles.progressWrap} accessibilityRole="progressbar" accessibilityValue={{ now: progressPct, min: 0, max: 100 }}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
            <Text style={styles.progressLabel}>{progressPct}%</Text>

            {slowHint ? (
              <Text style={styles.slowHint}>Nous avons presque terminé. Merci de garder cette fenêtre ouverte encore quelques instants.</Text>
            ) : (
              <Text style={styles.hint}>Cela peut prendre jusqu’à une minute selon votre connexion.</Text>
            )}

            {loading ? (
              <View style={styles.spinnerRow}>
                <ActivityIndicator color={THEME.brandPrimary} />
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
    backgroundColor: '#FFFFFF',
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
    backgroundColor: THEME.brandPrimary,
    borderRadius: scale(999),
  },
  progressLabel: { marginTop: scale(10), textAlign: 'center', color: THEME.textMuted, fontSize: scale(14) },
  hint: { marginTop: scale(14), textAlign: 'center', color: THEME.textMuted, fontSize: scale(14), lineHeight: scale(20) },
  slowHint: { marginTop: scale(14), textAlign: 'center', color: THEME.textMuted, fontSize: scale(14), lineHeight: scale(20) },
  spinnerRow: { marginTop: scale(14), alignItems: 'center' },
  cta: {
    marginTop: scale(18),
    backgroundColor: THEME.brandPrimary,
    paddingVertical: scale(14),
    borderRadius: scale(12),
    alignItems: 'center',
  },
  ctaText: { color: '#fff', fontSize: scale(16), fontWeight: '600' },
  secondaryWrap: { marginTop: scale(14), alignItems: 'center' },
  secondaryText: { color: THEME.textMuted, fontSize: scale(15) },
});

