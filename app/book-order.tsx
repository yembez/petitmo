import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { THEME } from '@/constants/theme';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import { scale } from '@/utils/responsive';
import { getUserTier } from '@/lib/userTier';
import { getLastGuestExportEmail, setLastGuestExportEmail } from '@/lib/guestExportPrefs';
import { calculateBookPriceEuros, type DiscountPercent } from '@/lib/printedBookQuote';
import { getBook, resolveBookCoverPrintUri, validateFreeTierBookMemoryLimits } from '@/services/books';
import { getChildren } from '@/services/children';
import { isInitExportConfigured } from '@/services/initExportApi';
import { initPrintOrderExport } from '@/services/printBookOrder';
import { fetchCrmPrefillByEmail } from '@/services/crmEdge';
import {
  generateBookPdfViaServerAsGuest,
  generateBookPdfWithExportTicket,
  collectMemoriesFromPagesForPdf,
  type GenerateBookPdfServerInput,
} from '@/services/bookPdfServer';
import { BookPdfGeneratingOverlay } from '@/components/BookPdfGeneratingOverlay';
import { getBookExportPrepIssues, runBookExportPrepInBackground } from '@/services/bookExportPrep';
import {
  clearPendingBookOrderPdfPayload,
  getPendingBookOrderPdfPayload,
  setBookOrderResultPdfUri,
} from '@/lib/pendingBookOrderPdf';
import { canExportBookPdfViaServer, grantDigitalExportPurchase, resolveServerPdfEntitlements } from '@/lib/digitalExportPurchase';
import { DIGITAL_EXPORT_PDF_EUR } from '@/lib/bookExportPricing';
import type { Child } from '@/types/local';
import { getPendingGuestRawUploadsCountForKeys } from '@/services/pendingRawGuestUploads';
import {
  gelatoCatalogPageCount,
  gelatoInnerPageCount,
  gelatoMinInnerPagesAlertMessage,
  GELATO_MIN_INNER_PAGES,
} from '@/utils/bookGelatoInnerPages';

const COUNTRY_OPTIONS = [
  { code: 'FR' as const, label: 'France' },
  { code: 'BE' as const, label: 'Belgique' },
  { code: 'CH' as const, label: 'Suisse' },
  { code: 'LU' as const, label: 'Luxembourg' },
] as const;

type CountryCode = (typeof COUNTRY_OPTIONS)[number]['code'];

type FieldKey =
  | 'email'
  | 'fullName'
  | 'shippingName'
  | 'line1'
  | 'line2'
  | 'city'
  | 'zip'
  | 'country'
  | 'submit';

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim().toLowerCase());
}

/** Couverture fraîche depuis SQLite (évite un pending stale après changement dans l’aperçu). */
async function withFreshBookCoverPhotoUrl(
  payload: GenerateBookPdfServerInput,
): Promise<GenerateBookPdfServerInput> {
  try {
    const book = await getBook(payload.bookId);
    if (!book) return payload;
    // Local-first : URI print / book_covers résolue avant la ref cloud stockée.
    const fresh = resolveBookCoverPrintUri(book)?.trim() || null;
    const stored = (book.coverPhotoUrl ?? '').trim();
    const next = fresh || stored;
    if (!next) return payload;
    return { ...payload, coverPhotoUrl: next };
  } catch {
    return payload;
  }
}

function pickAddressFromJson(
  j: unknown
): { line1: string; line2: string; city: string; zip: string; country: CountryCode } | null {
  if (j == null || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const line1 = typeof o.line1 === 'string' ? o.line1 : '';
  const line2 = typeof o.line2 === 'string' ? o.line2 : '';
  const city = typeof o.city === 'string' ? o.city : '';
  const zip = typeof o.zip === 'string' ? o.zip : '';
  const rawC = typeof o.country === 'string' ? o.country.toUpperCase() : '';
  const isCountry = (c: string): c is CountryCode => COUNTRY_OPTIONS.some(x => x.code === c);
  const country: CountryCode = isCountry(rawC) ? rawC : 'FR';
  if (!line1.trim() || !city.trim() || !zip.trim()) return null;
  return { line1: line1.trim(), line2, city: city.trim(), zip: zip.trim(), country };
}

function parseIntParam(v: string | string[] | undefined, fallback: number): number {
  if (typeof v !== 'string') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function isHttps(u: string | null | undefined): boolean {
  return typeof u === 'string' && /^https:\/\//i.test(u.trim());
}

function localUriForAvRawUpload(m: { local_original_path?: string | null; local_media_path?: string | null; media_url?: string | null; edited_media_url?: string | null }): string {
  const fromLocal = (m.local_original_path ?? m.local_media_path ?? '').trim();
  if (fromLocal) return fromLocal;
  const fallback = (m.media_url ?? m.edited_media_url ?? '').trim();
  if (fallback.toLowerCase().startsWith('file:')) return fallback;
  return '';
}

export default function BookOrderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    bookId?: string;
    childId?: string;
    memoryPageCount?: string;
    avPageCount?: string;
    exportMode?: string;
  }>();

  const bookId = typeof params.bookId === 'string' ? params.bookId : '';
  const childId = typeof params.childId === 'string' ? params.childId : '';
  const memoryPageCountParam = parseIntParam(params.memoryPageCount, -1);
  const avPageCountParam = parseIntParam(params.avPageCount, 0);
  const exportMode = params.exportMode === 'pdf' ? 'pdf' : 'print';

  const [loading, setLoading] = useState(true);
  const [child, setChild] = useState<Child | null>(null);
  const [bookTitle, setBookTitle] = useState('');
  const [memoryPageCount, setMemoryPageCount] = useState(0);
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [submitting, setSubmitting] = useState(false);
  const [pdfEntitled, setPdfEntitled] = useState({ premium: false, digitalPaid: false });
  const [blockedEmptyMemories, setBlockedEmptyMemories] = useState(false);
  const emptyBookAlertShownRef = useRef(false);
  const [prepHint, setPrepHint] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [shippingName, setShippingName] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState<CountryCode>('FR');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const billablePages = Math.max(0, memoryPageCount);
  const discountPercent: DiscountPercent = tier === 'paid' ? 20 : 0;
  const printPriceEuros = useMemo(
    () => calculateBookPriceEuros(billablePages, discountPercent),
    [billablePages, discountPercent]
  );
  const subscriptionDb: 'free' | 'paid' = tier === 'paid' ? 'paid' : 'free';

  const displayPriceEuros = useMemo(() => {
    if (exportMode === 'print') return printPriceEuros;
    if (pdfEntitled.premium || pdfEntitled.digitalPaid) return 0;
    return DIGITAL_EXPORT_PDF_EUR;
  }, [exportMode, printPriceEuros, pdfEntitled.digitalPaid, pdfEntitled.premium]);

  const ctaLabel = `Commander — ${displayPriceEuros.toFixed(2).replace('.', ',')}€`;

  const clearError = useCallback((k: FieldKey) => {
    setFieldErrors(prev => {
      const n = { ...prev };
      delete n[k];
      return n;
    });
  }, []);

  useEffect(() => {
    void (async () => {
      if (!bookId || !childId) {
        setLoading(false);
        return;
      }
      try {
        const [ent, tLast] = await Promise.all([
          resolveServerPdfEntitlements(),
          getLastGuestExportEmail(),
        ]);
        setPdfEntitled({
          premium: ent.subscriptionTier === 'premium',
          digitalPaid: ent.digitalExportPaid,
        });

        const [book, children, t] = await Promise.all([
          getBook(bookId),
          getChildren(),
          getUserTier(),
        ]);
        setTier(t);
        const ch = children.find(c => c.id === childId) ?? null;
        setChild(ch);
        if (book) {
          setBookTitle(book.title);
        }
        const mpc =
          memoryPageCountParam >= 0
            ? memoryPageCountParam
            : Math.max(0, book?.memoryIds?.length ?? 0);

        if (mpc < 1) {
          if (!emptyBookAlertShownRef.current) {
            emptyBookAlertShownRef.current = true;
            setBlockedEmptyMemories(true);
            Alert.alert('Livre vide', 'Ajoute au moins un souvenir pour créer un livre.', [
              { text: 'OK', onPress: () => router.replace('/(tabs)/fil') },
            ]);
          }
          return;
        }

        setMemoryPageCount(mpc);

        const startEmail = tLast?.trim() ?? '';
        if (startEmail) {
          setEmail(startEmail);
          const pre = await fetchCrmPrefillByEmail(startEmail);
          if (pre) {
            if (pre.full_name) setFullName(pre.full_name);
            const addr = pickAddressFromJson(
              pre.address_json && typeof pre.address_json === 'object' ? pre.address_json : null
            );
            if (addr) {
              setLine1(addr.line1);
              setLine2(addr.line2);
              setCity(addr.city);
              setZip(addr.zip);
              setCountry(addr.country);
            }
          }
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [bookId, childId, memoryPageCountParam, router]);

  const getFieldErrors = useCallback((): Partial<Record<FieldKey, string>> => {
    const e: Partial<Record<FieldKey, string>> = {};
    const em = email.trim();
    if (!em) e.email = 'Requis';
    else if (!isValidEmail(em)) e.email = 'Email invalide';

    if (exportMode === 'print') {
      if (!shippingName?.trim()) e.shippingName = 'Nom sur le colis requis';
      if (!line1?.trim()) e.line1 = 'Adresse requise';
      if (!city?.trim()) e.city = 'Ville requise';
      if (!zip?.trim()) e.zip = 'Code postal requis';
    }
    return e;
  }, [email, city, country, exportMode, line1, shippingName, zip]);

  const formIsComplete = useMemo(() => {
    if (!email.trim() || !isValidEmail(email)) return false;
    if (exportMode === 'print') {
      return (
        shippingName.trim().length > 0 &&
        line1.trim().length > 0 &&
        city.trim().length > 0 &&
        zip.trim().length > 0
      );
    }
    return true;
  }, [email, city, exportMode, line1, shippingName, zip]);

  const navigateToConfirmation = useCallback(
    (p: { pricePaidEuros: number; emailNorm: string }) => {
      router.replace({
        pathname: '/book-order-confirmation',
        params: {
          exportMode,
          priceEuros: String(p.pricePaidEuros),
          email: p.emailNorm,
          marketingOptIn: marketingOptIn ? '1' : '0',
        },
      });
    },
    [exportMode, marketingOptIn, router]
  );

  const navigateToFinalizeMedia = useCallback(
    (p: { pricePaidEuros: number; emailNorm: string; exportTicket: string }) => {
      router.replace({
        pathname: '/book-finalize-media',
        params: {
          exportMode,
          priceEuros: String(p.pricePaidEuros),
          email: p.emailNorm,
          marketingOptIn: marketingOptIn ? '1' : '0',
          exportTicket: p.exportTicket,
        },
      });
    },
    [exportMode, marketingOptIn, router]
  );

  const submitOrder = useCallback(async () => {
    if (!bookId || !childId || !child) return;
    if (billablePages < 1) {
      Alert.alert('Livre vide', 'Ajoute au moins un souvenir pour créer un livre.', [
        { text: 'OK', onPress: () => router.replace('/(tabs)/fil') },
      ]);
      return;
    }
    const errs = getFieldErrors();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    if (!isInitExportConfigured()) {
      setFieldErrors({ submit: 'Configuration Supabase (init-export) manquante.' });
      return;
    }

    const mail = email.trim().toLowerCase();
    const nowIso = new Date().toISOString();

    // Plan gratuit : quotas audio/vidéo livre ; QR cloud après paiement (spec free-tier-book-qr-av.md).
    const pendingPayload = await getPendingBookOrderPdfPayload();
    if (subscriptionDb === 'free' && pendingPayload) {
      const memories = collectMemoriesFromPagesForPdf(pendingPayload.pages, pendingPayload.localEdits ?? {});
      try {
        await validateFreeTierBookMemoryLimits(memories);
      } catch (e) {
        setFieldErrors({
          submit: e instanceof Error ? e.message : 'Limite plan gratuit atteinte pour ce livre.',
        });
        return;
      }
    }

    if (exportMode === 'print') {
      if (!isInitExportConfigured()) return;
      if (pendingPayload) {
        const catalogPagesForGelato = gelatoCatalogPageCount(pendingPayload.pages);
        if (catalogPagesForGelato < GELATO_MIN_INNER_PAGES) {
          Alert.alert(
            'Livre trop court pour l’impression',
            gelatoMinInnerPagesAlertMessage(gelatoInnerPageCount(pendingPayload.pages)),
          );
          return;
        }
      }
      setSubmitting(true);
      try {
        if (!pendingPayload) {
          setFieldErrors({ submit: 'Aucun aperçu de livre chargé. Repasse par l’aperçu du livre.' });
          return;
        }
        const payload = await withFreshBookCoverPhotoUrl(pendingPayload);

        void getBookExportPrepIssues({
          pages: payload.pages,
          localEdits: payload.localEdits,
          coverPhotoUrl: payload.coverPhotoUrl,
          child: payload.child,
        });

        const res = await initPrintOrderExport({
          bookId,
          childLocalId: childId,
          subscriptionTierDb: subscriptionDb,
          audioVideoPageCount: avPageCountParam,
          email: mail,
          gdprConsentAtIso: nowIso,
          fullName: fullName.trim() || null,
          marketingOptIn: marketingOptIn,
          shippingName: shippingName.trim(),
          shippingAddress: {
            line1: line1.trim(),
            ...(line2.trim() ? { line2: line2.trim() } : {}),
            city: city.trim(),
            zip: zip.trim(),
            country,
          },
          billablePages: Math.min(200, billablePages),
          discountPercent,
          printerName: 'gelato',
        });

        const subscriptionTierPdf = subscriptionDb === 'paid' ? 'premium' : 'free';
        const { localUri, response: pdfResponse } = await generateBookPdfWithExportTicket({
          ...payload,
          exportMode: 'print',
          exportTicket: res.exportTicket,
          subscriptionTier: subscriptionTierPdf,
        });

        await setBookOrderResultPdfUri(localUri);
        await setLastGuestExportEmail(mail);
        const pricePaid = res.priceCents / 100;

        const gelato = pdfResponse.gelato;
        if (__DEV__) {
          console.log('[book-order] gelato', gelato ?? '(absent — serveur PDF pas encore redéployé ?)');
        }
        if (!gelato?.ok) {
          const detail =
            gelato?.message?.trim() ||
            'Le PDF a été généré mais Gelato n’a pas reçu la commande (voir logs serveur / export_requests.last_error).';
          Alert.alert(
            'Gelato non envoyé',
            `${detail}${
              gelato?.skipped ? '\n\nSouvent : GELATO_* manquant sur Railway, ou GELATO_ORDER_TYPE.' : ''
            }\n\nLe PDF local est quand même disponible.`,
            [{ text: 'OK' }],
          );
        } else if (__DEV__ && gelato.orderId) {
          Alert.alert(
            'Gelato OK',
            `Order ${gelato.orderType === 'draft' ? 'draft' : ''} ${gelato.orderId}`,
            [{ text: 'OK' }],
          );
        }

        const memories = collectMemoriesFromPagesForPdf(payload.pages, payload.localEdits ?? {});
        const av = memories.filter(m => m.type === 'voice' || m.type === 'video');
        const avKeys = av.map(m => `${m.type === 'voice' ? 'audio' : 'video'}:${m.id}`);
        const hasPendingUploads = (await getPendingGuestRawUploadsCountForKeys(avKeys)) > 0;
        const hasLocalAvToUpload = av.some(m => {
          const local = localUriForAvRawUpload(m);
          if (local) return true;
          const main = (m.media_url ?? m.edited_media_url ?? '').trim();
          return main ? !isHttps(main) : true;
        });

        if (av.length > 0 && (hasPendingUploads || hasLocalAvToUpload)) {
          navigateToFinalizeMedia({ pricePaidEuros: pricePaid, emailNorm: mail, exportTicket: res.exportTicket });
          return;
        }

        await clearPendingBookOrderPdfPayload();
        navigateToConfirmation({ pricePaidEuros: pricePaid, emailNorm: mail });
      } catch (e) {
        if (e instanceof Error && (e.message === 'PREP_NOT_READY' || e.message.startsWith('PREP_NOT_READY:'))) {
          setFieldErrors({ submit: 'Préparation des médias en cours. Attends quelques secondes puis réessaie.' });
        } else if (
          e instanceof Error &&
          (e.message.includes('not readable') || e.message.includes('renderAsync'))
        ) {
          setFieldErrors({
            submit:
              'Une photo du livre est introuvable sur cet appareil. Rouvre l’aperçu du livre, attends quelques secondes, puis réessaie.',
          });
        } else {
          setFieldErrors({ submit: e instanceof Error ? e.message : 'Échec de la commande.' });
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // PDF
    setSubmitting(true);
    setPrepHint(null);
    try {
      const pending = await getPendingBookOrderPdfPayload();
      if (!pending) {
        setFieldErrors({ submit: 'Aucun aperçu de livre chargé. Repasse par l’aperçu du livre.' });
        return;
      }
      const payload = await withFreshBookCoverPhotoUrl(pending);

      // Le flux guest gère désormais photo + audio + vidéo via upload vers le serveur PDF (ticket),
      // donc on ne bloque plus ici sur des médias locaux (préparation best-effort uniquement).
      void getBookExportPrepIssues({
        pages: payload.pages,
        localEdits: payload.localEdits,
        coverPhotoUrl: payload.coverPhotoUrl,
        child: payload.child,
      });
      setPrepHint(null);

      const wasEntitled = await canExportBookPdfViaServer();
      const pricePaid = wasEntitled ? 0 : DIGITAL_EXPORT_PDF_EUR;
      if (!wasEntitled) {
        await grantDigitalExportPurchase();
        setPdfEntitled({ premium: true, digitalPaid: true });
      }

      const { localUri, init } = await generateBookPdfViaServerAsGuest({
        ...payload,
        consent: {
          email: mail,
          gdprConsentAtIso: nowIso,
          fullName: fullName.trim() || null,
          marketingOptIn: marketingOptIn === true,
        },
      });

      await setLastGuestExportEmail(mail);
      await clearPendingBookOrderPdfPayload();
      await setBookOrderResultPdfUri(localUri);

      // Plan gratuit : QR médias audio uniquement, finalisation après paiement si nécessaire.
      if (subscriptionDb === 'free') {
        const memories = collectMemoriesFromPagesForPdf(payload.pages, payload.localEdits ?? {});
        const av = memories.filter(m => m.type === 'voice' || m.type === 'video');
        const keys = av.map(m => `${m.type === 'voice' ? 'audio' : 'video'}:${m.id}`);
        const hasPending = (await getPendingGuestRawUploadsCountForKeys(keys)) > 0;
        const hasLocalOrMissingCloud = av.some(m => {
          const local = localUriForAvRawUpload(m);
          if (local) return true;
          const main = (m.media_url ?? m.edited_media_url ?? '').trim();
          return main ? !isHttps(main) : true;
        });
        if ((hasPending || hasLocalOrMissingCloud) && init?.pdfTicket) {
          navigateToFinalizeMedia({ pricePaidEuros: pricePaid, emailNorm: mail, exportTicket: init.pdfTicket });
          return;
        }
      }

      navigateToConfirmation({ pricePaidEuros: pricePaid, emailNorm: mail });
    } catch (e) {
      if (e instanceof Error && e.message === 'EXPORT_PAYMENT_REQUIRED') {
        setFieldErrors({ submit: 'Achat requis (export PDF) ou compte non éligible.' });
      } else if (e instanceof Error && (e.message === 'PREP_NOT_READY' || e.message.startsWith('PREP_NOT_READY:'))) {
        setFieldErrors({ submit: 'Préparation des médias en cours. Attends quelques secondes puis réessaie.' });
      } else if (
        e instanceof Error &&
        (e.message.includes('not readable') || e.message.includes('renderAsync'))
      ) {
        setFieldErrors({
          submit:
            'Une photo du livre est introuvable sur cet appareil. Rouvre l’aperçu du livre, attends quelques secondes, puis réessaie.',
        });
      } else {
        setFieldErrors({ submit: e instanceof Error ? e.message : 'Export impossible.' });
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    avPageCountParam,
    billablePages,
    bookId,
    child,
    childId,
    country,
    discountPercent,
    email,
    exportMode,
    fullName,
    getFieldErrors,
    line1,
    line2,
    marketingOptIn,
    navigateToConfirmation,
    navigateToFinalizeMedia,
    router,
    shippingName,
    subscriptionDb,
    zip,
    city,
  ]);

  if (!bookId || !childId) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + scale(12) }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backRow}>
          <Text style={styles.backText}>← Retour</Text>
        </Pressable>
        <Text style={styles.title}>Commande</Text>
        <Text style={styles.muted}>
          Ouvre cette page depuis l’aperçu d’un livre (commande PDF ou impression).
        </Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={THEME.brandCtaOrange} />
      </View>
    );
  }

  if (blockedEmptyMemories) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={THEME.brandCtaOrange} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + scale(12), paddingBottom: insets.bottom + scale(24) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backRow}>
          <Text style={styles.backText}>← Retour</Text>
        </Pressable>

        <Text style={styles.title}>
          {exportMode === 'print' ? 'Livre imprimé' : 'Livre PDF'}
        </Text>
        <Text style={styles.sub}>
          {bookTitle || 'Ton livre'} · {child?.name ?? 'Enfant'}
        </Text>

        {exportMode === 'print' && tier === 'free' ? (
          <Pressable
            style={styles.banner}
            onPress={() =>
              router.push({ pathname: '/paywall', params: { context: 'BOOK_ORDER_DISCOUNT' } })
            }
          >
            <Text style={styles.bannerText}>
              Petitmo+ : −20 % sur l’impression. Touche ici pour en profiter.
            </Text>
          </Pressable>
        ) : null}

        {exportMode === 'print' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tarif impression</Text>
            <Text style={styles.rowMuted}>
              Pages mémoire : {billablePages} (facturation min. 20)
            </Text>
            <Text style={styles.price}>{printPriceEuros.toFixed(2).replace('.', ',')} € TTC</Text>
            {__DEV__ ? (
              <Text style={[styles.rowMuted, { marginTop: 8 }]}>
                Dev : aucun paiement réel. Gelato draft si Railway a GELATO_ORDER_TYPE=draft.
              </Text>
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Livre PDF</Text>
            <Text style={styles.rowMuted}>
              {pdfEntitled.premium || pdfEntitled.digitalPaid
                ? 'Inclus dans ton forfait ou achat actuel.'
                : 'Tarif hors forfait : l’achat est pris en compte au moment de la commande.'}
            </Text>
            <Text style={styles.price}>
              {displayPriceEuros.toFixed(2).replace('.', ',')} € TTC
            </Text>
            {prepHint ? <Text style={[styles.rowMuted, { marginTop: 8, color: '#B91C1C' }]}>{prepHint}</Text> : null}
          </View>
        )}

        <Text style={styles.section}>Contact</Text>
        <TextInput
          style={[styles.input, fieldErrors.email && styles.inputError]}
          value={email}
          onChangeText={t => {
            setEmail(t);
            clearError('email');
          }}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {fieldErrors.email ? <Text style={styles.err}>{fieldErrors.email}</Text> : null}
        <Text style={styles.hintDiscreet}>
          Utilisé uniquement pour le suivi de ta commande.
        </Text>

        <Text style={styles.sectionLabel}>Prénom et nom (optionnel)</Text>
        <TextInput
          style={styles.input}
          value={fullName}
          onChangeText={setFullName}
          placeholder="Prénom et nom"
        />

        {exportMode === 'print' && __DEV__ ? (
          <Pressable
            style={styles.devFillBtn}
            onPress={() => {
              const stamp = Date.now().toString(36);
              setEmail(`qa+gelato-${stamp}@example.com`);
              setFullName('Test Petitmo Gelato');
              setShippingName('Test Petitmo Gelato');
              setLine1('12 rue Example');
              setLine2('');
              setCity('Paris');
              setZip('75001');
              setCountry('FR');
              setFieldErrors({});
            }}
          >
            <Text style={styles.devFillBtnText}>Dev : préremplir adresse test Gelato</Text>
          </Pressable>
        ) : null}

        {exportMode === 'print' ? (
          <>
            <Text style={styles.section}>Livraison</Text>
            <TextInput
              style={[styles.input, fieldErrors.shippingName && styles.inputError]}
              value={shippingName}
              onChangeText={t => {
                setShippingName(t);
                clearError('shippingName');
              }}
              placeholder="Prénom Nom (peut être différent si c'est un cadeau)"
            />
            {fieldErrors.shippingName ? <Text style={styles.err}>{fieldErrors.shippingName}</Text> : null}

            <TextInput
              style={[styles.input, fieldErrors.line1 && styles.inputError]}
              value={line1}
              onChangeText={t => {
                setLine1(t);
                clearError('line1');
              }}
              placeholder="Adresse ligne 1"
            />
            {fieldErrors.line1 ? <Text style={styles.err}>{fieldErrors.line1}</Text> : null}
            <TextInput
              style={styles.input}
              value={line2}
              onChangeText={setLine2}
              placeholder="Appartement, bâtiment..."
            />
            <View style={styles.row2}>
              <View style={styles.grow}>
                <TextInput
                  style={[styles.input, fieldErrors.zip && styles.inputError]}
                  value={zip}
                  onChangeText={t => {
                    setZip(t);
                    clearError('zip');
                  }}
                  placeholder="Code postal"
                />
                {fieldErrors.zip ? <Text style={styles.err}>{fieldErrors.zip}</Text> : null}
              </View>
              <View style={styles.grow2}>
                <TextInput
                  style={[styles.input, fieldErrors.city && styles.inputError]}
                  value={city}
                  onChangeText={t => {
                    setCity(t);
                    clearError('city');
                  }}
                  placeholder="Ville"
                />
                {fieldErrors.city ? <Text style={styles.err}>{fieldErrors.city}</Text> : null}
              </View>
            </View>
            <Text style={styles.sectionLabel}>Pays</Text>
            <View style={styles.countryRow}>
              {COUNTRY_OPTIONS.map(o => {
                const sel = o.code === country;
                return (
                  <Pressable
                    key={o.code}
                    style={[styles.chip, sel && styles.chipOn]}
                    onPress={() => setCountry(o.code)}
                  >
                    <Text style={[styles.chipText, sel && styles.chipTextOn]}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        <Pressable
          style={styles.checkRow}
          onPress={() => setMarketingOptIn(v => !v)}
          hitSlop={4}
        >
          <View style={[styles.checkbox, marketingOptIn && styles.checkboxOn]} />
          <Text style={styles.checkLabel}>Recevoir les conseils et offres petitmo</Text>
        </Pressable>

        {fieldErrors.submit ? <Text style={styles.err}>{fieldErrors.submit}</Text> : null}

        <Pressable
          style={[
            petitmoCtaStyles.primary,
            petitmoCtaStyles.primaryFullWidth,
            styles.cta,
            (submitting || !formIsComplete) && petitmoCtaStyles.primaryDisabled,
          ]}
          disabled={submitting || !formIsComplete}
          onPress={() => void submitOrder()}
        >
          {submitting ? (
            <ActivityIndicator color={PETITMO_CTA_SPINNER_COLOR} />
          ) : (
            <Text style={[petitmoCtaStyles.primaryText, styles.ctaText]}>{ctaLabel}</Text>
          )}
        </Pressable>
      </ScrollView>

      <BookPdfGeneratingOverlay visible={submitting && (exportMode === 'pdf' || exportMode === 'print')} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: THEME.bgScreen },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: THEME.bgScreen },
  root: { flex: 1, backgroundColor: THEME.bgScreen, paddingHorizontal: scale(20) },
  scroll: { paddingHorizontal: scale(20) },
  backRow: { marginBottom: scale(8), alignSelf: 'flex-start' },
  backText: { fontSize: scale(16), color: THEME.accent, fontWeight: '600' },
  title: { fontSize: scale(22), fontWeight: '700', color: THEME.textPrimary, marginBottom: scale(4) },
  sub: { fontSize: scale(15), color: THEME.textMuted, marginBottom: scale(16) },
  muted: { fontSize: scale(15), color: THEME.textMuted, marginTop: scale(12) },
  banner: {
    backgroundColor: 'rgba(28, 28, 30, 0.06)',
    padding: scale(14),
    borderRadius: scale(12),
    marginBottom: scale(16),
  },
  bannerText: { fontSize: scale(14), color: THEME.textPrimary, lineHeight: scale(20) },
  devFillBtn: {
    alignSelf: 'flex-start',
    marginBottom: scale(12),
    paddingVertical: scale(8),
    paddingHorizontal: scale(12),
    borderRadius: scale(8),
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
  },
  devFillBtnText: { fontSize: scale(13), fontWeight: '600', color: '#1D4ED8' },
  card: {
    backgroundColor: THEME.bg,
    borderRadius: scale(12),
    padding: scale(16),
    marginBottom: scale(16),
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.06)',
  },
  cardTitle: { fontSize: scale(16), fontWeight: '700', color: THEME.textPrimary, marginBottom: scale(8) },
  rowMuted: { fontSize: scale(14), color: THEME.textMuted, marginBottom: scale(4) },
  price: { fontSize: scale(22), fontWeight: '700', color: THEME.textPrimary, marginTop: scale(8) },
  section: {
    fontSize: scale(13),
    fontWeight: '600',
    color: THEME.textMuted,
    textTransform: 'uppercase',
    marginBottom: scale(8),
    marginTop: scale(4),
  },
  sectionLabel: { fontSize: scale(14), color: THEME.textMuted, marginBottom: scale(6) },
  input: {
    borderWidth: 1,
    borderColor: '#C7C7CC',
    borderRadius: scale(10),
    paddingHorizontal: scale(12),
    paddingVertical: scale(10),
    fontSize: scale(16),
    marginBottom: scale(6),
    color: THEME.textPrimary,
    backgroundColor: THEME.bg,
  },
  inputError: { borderColor: 'rgba(180, 60, 60, 0.5)' },
  err: { fontSize: scale(13), color: 'rgba(180, 60, 60, 0.9)', marginBottom: scale(8) },
  hintDiscreet: { fontSize: scale(12), color: THEME.textSecondary, marginBottom: scale(14) },
  row2: { flexDirection: 'row', gap: scale(10) },
  grow: { flex: 1, minWidth: 0 },
  grow2: { flex: 2, minWidth: 0 },
  countryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: scale(8), marginBottom: scale(8) },
  chip: {
    borderWidth: 1,
    borderColor: '#C7C7CC',
    borderRadius: scale(10),
    paddingHorizontal: scale(10),
    paddingVertical: scale(6),
  },
  chipOn: { borderColor: THEME.brandCtaOrange, backgroundColor: 'rgba(255, 127, 79, 0.08)' },
  chipText: { fontSize: scale(13), color: THEME.textPrimary },
  chipTextOn: { fontWeight: '600' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: scale(10), marginTop: scale(8), marginBottom: scale(12) },
  checkbox: {
    width: scale(22),
    height: scale(22),
    borderRadius: scale(6),
    borderWidth: 2,
    borderColor: THEME.textSecondary,
  },
  checkboxOn: { backgroundColor: THEME.brandCtaOrange, borderColor: THEME.brandCtaOrange },
  checkLabel: { flex: 1, fontSize: scale(14), color: THEME.textPrimary, lineHeight: scale(20) },
  cta: {
    marginTop: scale(8),
  },
  ctaText: {
    fontSize: scale(16),
  },
});
