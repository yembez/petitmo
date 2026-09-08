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
  Linking,
  AppState,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import * as ExpoLinking from 'expo-linking';
import { ChevronRight } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { CAPTURE_CTA_BORDER } from '@/constants/captureScreenPalette';
import { PETITMO_CTA_BORDER_WIDTH, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import {
  BOOK_COVER_THUMB_HEIGHT,
  BOOK_COVER_THUMB_WIDTH,
} from '@/constants/bookCoverThumbnail';
import { scale } from '@/utils/responsive';
import { formatAppCurrency } from '@/utils/appLocale';
import { getUserTier } from '@/lib/userTier';
import { getLastGuestExportEmail, setLastGuestExportEmail } from '@/lib/guestExportPrefs';
import { PRINT_V1_INCLUDED_QR, quotePrintOrderV1 } from '@/lib/pricingV1';
import { PRINT_V1_PAID_DISCOUNT_PERCENT, type DiscountPercent } from '@/lib/printedBookQuote';
import { PRINT_ORDER_CGV_URL, PRINT_ORDER_CGV_VERSION } from '@/lib/printOrderLegal';
import {
  getBook,
  resolveBookCoverPrintUri,
  resolveBookListRowCoverUri,
  type Book,
} from '@/services/books';
import { listLocalChildren } from '@/lib/localDb';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import { getChildren } from '@/services/children';
import { isInitExportConfigured } from '@/services/initExportApi';
import { initPrintOrderExport } from '@/services/printBookOrder';
import {
  createPrintPayment,
  fetchPrintPaymentStatus,
  openPrintCheckoutAndWaitPaid,
  waitUntilPrintPaid,
} from '@/services/printPayment';
import { fetchCrmPrefillByEmail } from '@/services/crmEdge';
import {
  generateBookPdfViaServerAsGuest,
  generateBookPdfWithExportTicket,
  collectMemoriesFromPagesForPdf,
  refreshBookPdfPagesMemoriesFromSqlite,
  type GenerateBookPdfServerInput,
} from '@/services/bookPdfServer';
import {
  BookPdfGeneratingOverlay,
  BookPdfGeneratingView,
} from '@/components/BookPdfGeneratingOverlay';
import BookCoverThumbnail from '@/components/BookCoverThumbnail';
import { getBookExportPrepIssues } from '@/services/bookExportPrep';
import {
  clearPendingBookOrderPdfPayload,
  getPendingBookOrderPdfPayload,
  setBookOrderResultPdfUri,
} from '@/lib/pendingBookOrderPdf';
import {
  peekExportTicketClaims,
  setPendingExportUploadTicket,
  isExportTicketExpired,
} from '@/lib/pendingExportUploadTicket';
import {
  clearPendingPrintPayment,
  getPendingPrintPayment,
  setPendingPrintPayment,
} from '@/lib/pendingPrintPayment';
import { canExportBookPdfViaServer, grantDigitalExportPurchase, resolveServerPdfEntitlements } from '@/lib/digitalExportPurchase';
import { DIGITAL_EXPORT_PDF_EUR } from '@/lib/bookExportPricing';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import type { Child } from '@/types/local';
import { getPendingGuestRawUploadsCountForKeys } from '@/services/pendingRawGuestUploads';
import {
  gelatoCatalogPageCount,
  gelatoInnerPageCount,
  gelatoMinInnerPagesAlertMessage,
  GELATO_MIN_INNER_PAGES,
} from '@/utils/bookGelatoInnerPages';
import { bookCoverPeriodLabelForBook } from '@/utils/bookCoverPeriodLabel';
import { normalizeMemoryMediaUriForDisplay } from '@/utils/memoryPhotos';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useAppLanguage } from '@/hooks/useAppLanguage';
import { useFonts } from '@expo-google-fonts/dm-sans';
import {
  BOOK_SERIF_FONT_FAMILY,
  BOOK_SERIF_FONT_SOURCES,
  BOOK_SERIF_ITALIC_FONT_FAMILY,
} from '@/constants/bookSerifFont';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { rememberLocalPrintOrder } from '@/lib/printOrdersCache';
import { isDeviceStorageFullError } from '@/utils/deviceStorageFull';

WebBrowser.maybeCompleteAuthSession();

/** Empêche un double generate-pdf si le deep link remonte book-order pendant le fulfill. */
let printFulfillInFlight = false;

/** Miniature couverture carte commande — même composant que l’onglet Livres, un cran plus petit. */
const ORDER_COVER_SCALE = 0.78;

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

/** Couverture + souvenirs + crops frais depuis SQLite (évite un pending stale après la maquette). */
async function withFreshBookPayloadForExport(
  payload: GenerateBookPdfServerInput,
): Promise<GenerateBookPdfServerInput> {
  try {
    const book = await getBook(payload.bookId);
    const pages = refreshBookPdfPagesMemoriesFromSqlite(payload.pages);
    const familyFromLocal = sortChildrenByBirthdateAsc(listLocalChildren());
    let next: GenerateBookPdfServerInput = {
      ...payload,
      pages,
      familyChildren:
        familyFromLocal.length > 0
          ? familyFromLocal
          : payload.familyChildren && payload.familyChildren.length > 0
            ? payload.familyChildren
            : [payload.child],
    };
    if (book) {
      // Local-first : URI print / book_covers résolue avant la ref cloud stockée.
      const fresh = resolveBookCoverPrintUri(book)?.trim() || null;
      const stored = (book.coverPhotoUrl ?? '').trim();
      const cover = fresh || stored;
      if (cover) next = { ...next, coverPhotoUrl: cover };
      // Crops / rotations du livre persisté (= maquette auto-save), pas le snapshot pending.
      if (book.photoCrops && Object.keys(book.photoCrops).length > 0) {
        next = { ...next, photoCrops: book.photoCrops };
      }
      if (book.rotations && Object.keys(book.rotations).length > 0) {
        next = { ...next, rotations: book.rotations };
      }
    }
    // Invalider les dims vidéo du pending → re-mesure du poster_print local à l’upload.
    if (next.cropImgPxByMemoryId) {
      const videoIds = new Set<string>();
      for (const p of pages) {
        if (p.type !== 'video') continue;
        const id = 'memory' in p && p.memory?.id ? p.memory.id : '';
        if (id) videoIds.add(id);
      }
      if (videoIds.size > 0) {
        const cropped = { ...next.cropImgPxByMemoryId };
        for (const id of videoIds) delete cropped[id];
        next = {
          ...next,
          cropImgPxByMemoryId: Object.keys(cropped).length > 0 ? cropped : undefined,
        };
      }
    }
    return next;
  } catch {
    return {
      ...payload,
      pages: refreshBookPdfPagesMemoriesFromSqlite(payload.pages),
    };
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
  const { t } = useAppTranslation('common');
  const lang = useAppLanguage();
  const { dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const [coverFontsLoaded] = useFonts({ ...BOOK_SERIF_FONT_SOURCES });
  const coverTitleFontFamily = coverFontsLoaded ? BOOK_SERIF_ITALIC_FONT_FAMILY : undefined;
  const coverPeriodFontFamily = coverFontsLoaded ? BOOK_SERIF_FONT_FAMILY : undefined;
  const params = useLocalSearchParams<{
    bookId?: string;
    childId?: string;
    memoryPageCount?: string;
    avPageCount?: string;
    gelatoPageCount?: string;
    exportMode?: string;
    resumePayment?: string;
  }>();

  const bookId = typeof params.bookId === 'string' ? params.bookId : '';
  const childId = typeof params.childId === 'string' ? params.childId : '';
  const memoryPageCountParam = parseIntParam(params.memoryPageCount, -1);
  const avPageCountParam = parseIntParam(params.avPageCount, 0);
  const gelatoPageCountParam = parseIntParam(params.gelatoPageCount, -1);
  const exportMode = params.exportMode === 'pdf' ? 'pdf' : 'print';
  const resumePayment = params.resumePayment === '1';

  const [loading, setLoading] = useState(true);
  const [child, setChild] = useState<Child | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [memoryPageCount, setMemoryPageCount] = useState(0);
  /** Compteurs devis — rafraîchis au retour de « Revoir mon livre » (ajout / suppression). */
  const [qrCountForQuote, setQrCountForQuote] = useState(Math.max(0, avPageCountParam));
  const [gelatoPagesForQuote, setGelatoPagesForQuote] = useState(
    gelatoPageCountParam >= 0 ? gelatoPageCountParam : Math.max(GELATO_MIN_INNER_PAGES, 0),
  );
  const [tier, setTier] = useState<'free' | 'paid'>('free');
  const [submitting, setSubmitting] = useState(false);
  const [printPhase, setPrintPhase] = useState<'idle' | 'paying' | 'fulfilling'>('idle');
  const fulfillLockRef = useRef(false);
  const submittingRef = useRef(false);
  const [pdfEntitled, setPdfEntitled] = useState({ premium: false, digitalPaid: false });
  const [blockedEmptyMemories, setBlockedEmptyMemories] = useState(false);
  const emptyBookAlertShownRef = useRef(false);
  const [prepHint, setPrepHint] = useState<string | null>(null);
  const [priceDetailOpen, setPriceDetailOpen] = useState(false);
  const [emailEditing, setEmailEditing] = useState(false);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  /** Case légale impression — décochée par défaut. */
  const [contentVerified, setContentVerified] = useState(false);
  const [shippingName, setShippingName] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [zip, setZip] = useState('');
  const [country, setCountry] = useState<CountryCode>('FR');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  const coverRaw = book ? resolveBookListRowCoverUri(book) : '';
  const coverSigned = useSignedMediaUrl(coverRaw || null) ?? '';
  const coverUri =
    normalizeMemoryMediaUriForDisplay((coverSigned || coverRaw).trim()) || null;
  const coverCrop = book?.photoCrops?.cover;
  const coverCropKey = coverCrop
    ? `${coverCrop.xPct}-${coverCrop.yPct}-${coverCrop.scale}`
    : '';
  const coverDateLabel = book ? bookCoverPeriodLabelForBook(book) : '';
  const bookTitle = book?.title?.trim() || '';

  const discountPercent: DiscountPercent =
    tier === 'paid' ? PRINT_V1_PAID_DISCOUNT_PERCENT : 0;
  const printQuote = useMemo(
    () =>
      quotePrintOrderV1({
        gelatoPages: gelatoPagesForQuote > 0 ? gelatoPagesForQuote : GELATO_MIN_INNER_PAGES,
        qrCount: qrCountForQuote,
        tier,
      }),
    [gelatoPagesForQuote, qrCountForQuote, tier],
  );
  const printPriceEuros = printQuote.totalEuros;
  const subscriptionDb: 'free' | 'paid' = tier === 'paid' ? 'paid' : 'free';

  const displayPriceEuros = useMemo(() => {
    if (exportMode === 'print') return printPriceEuros;
    if (pdfEntitled.premium || pdfEntitled.digitalPaid) return 0;
    return DIGITAL_EXPORT_PDF_EUR;
  }, [exportMode, printPriceEuros, pdfEntitled.digitalPaid, pdfEntitled.premium]);

  const priceLabel = formatAppCurrency(displayPriceEuros, lang);
  const ctaLabel =
    exportMode === 'print'
      ? t('bookOrder.ctaPay', { price: priceLabel })
      : t('bookOrder.ctaPay', { price: priceLabel });

  const pagesForMeta =
    printQuote.billedPages > 0 ? printQuote.billedPages : Math.max(gelatoPagesForQuote, GELATO_MIN_INNER_PAGES);
  const pagesQrMeta = t(
    qrCountForQuote === 1 ? 'bookOrder.pagesQrMetaOne' : 'bookOrder.pagesQrMeta',
    { pages: pagesForMeta, qr: qrCountForQuote },
  );

  const countryLabel =
    COUNTRY_OPTIONS.find(o => o.code === country)?.label ?? country;

  const showEmailDisplay = !emailEditing && isValidEmail(email);

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
          setBook(book);
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
          setEmailEditing(false);
          const pre = await fetchCrmPrefillByEmail(startEmail);
          if (pre) {
            if (pre.full_name) {
              setFullName(pre.full_name);
              setShippingName(prev => (prev.trim() ? prev : pre.full_name!.trim()));
            }
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

  /** Au retour de la revue livre : recalcule pages / QR / prix depuis le pending rafraîchi. */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        if (!bookId) return;
        try {
          const freshBook = await getBook(bookId);
          if (alive && freshBook) setBook(freshBook);
        } catch {
          /* ignore */
        }
        if (exportMode !== 'print') return;
        const pending = await getPendingBookOrderPdfPayload();
        if (!alive || !pending || pending.bookId !== bookId) return;
        const pages = pending.pages ?? [];
        if (!Array.isArray(pages) || pages.length === 0) return;
        const av = pages.filter(p => p.type === 'audio' || p.type === 'video').length;
        const gelato = gelatoCatalogPageCount(pages);
        const mpc = pages.filter(
          p =>
            p.type === 'photo-full' ||
            p.type === 'photo-note' ||
            p.type === 'quote' ||
            p.type === 'audio' ||
            p.type === 'video',
        ).length;
        setQrCountForQuote(av);
        if (gelato > 0) setGelatoPagesForQuote(gelato);
        if (mpc > 0) setMemoryPageCount(mpc);
      })();
      return () => {
        alive = false;
      };
    }, [bookId, exportMode]),
  );

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
        contentVerified &&
        shippingName.trim().length > 0 &&
        line1.trim().length > 0 &&
        city.trim().length > 0 &&
        zip.trim().length > 0
      );
    }
    return true;
  }, [contentVerified, email, city, exportMode, line1, shippingName, zip]);

  const navigateToConfirmation = useCallback(
    (p: { pricePaidEuros: number; emailNorm: string }) => {
      router.replace({
        pathname: '/book-order-confirmation',
        params: {
          exportMode,
          priceEuros: String(p.pricePaidEuros),
          email: p.emailNorm,
          marketingOptIn: '0',
        },
      });
    },
    [exportMode, router]
  );

  const navigateToFinalizeMedia = useCallback(
    (p: { pricePaidEuros: number; emailNorm: string; exportTicket: string }) => {
      void (async () => {
        try {
          await setPendingExportUploadTicket(p.exportTicket, {
            email: p.emailNorm,
          });
        } catch (e) {
          if (__DEV__) console.warn('[book-order] setPendingExportUploadTicket', e);
        }
        router.replace({
          pathname: '/book-finalize-media',
          params: {
            exportMode,
            priceEuros: String(p.pricePaidEuros),
            email: p.emailNorm,
            marketingOptIn: '0',
          },
        });
      })();
    },
    [exportMode, router]
  );

  const fulfillPrintAfterPaid = useCallback(
    async (opts: { exportTicket: string; emailNorm: string; priceCents: number }) => {
      if (printFulfillInFlight || fulfillLockRef.current) return;
      printFulfillInFlight = true;
      fulfillLockRef.current = true;
      setSubmitting(true);
      submittingRef.current = true;
      setPrintPhase('fulfilling');
      try {
        const pendingPayload = await getPendingBookOrderPdfPayload();
        if (!pendingPayload) {
          throw new Error('Aucun aperçu de livre chargé. Repasse par l’aperçu du livre.');
        }
        const catalogPagesForGelato = gelatoCatalogPageCount(pendingPayload.pages);
        if (catalogPagesForGelato < GELATO_MIN_INNER_PAGES) {
          Alert.alert(
            'Livre trop court pour l’impression',
            gelatoMinInnerPagesAlertMessage(gelatoInnerPageCount(pendingPayload.pages)),
          );
          return;
        }

        const payload = await withFreshBookPayloadForExport(pendingPayload);
        void getBookExportPrepIssues({
          pages: payload.pages,
          localEdits: payload.localEdits,
          coverPhotoUrl: payload.coverPhotoUrl,
          child: payload.child,
        });

        const subscriptionTierPdf = subscriptionDb === 'paid' ? 'premium' : 'free';
        const { localUri, response: pdfResponse } = await generateBookPdfWithExportTicket({
          ...payload,
          exportMode: 'print',
          exportTicket: opts.exportTicket,
          subscriptionTier: subscriptionTierPdf,
        });

        await setBookOrderResultPdfUri(localUri);
        await setLastGuestExportEmail(opts.emailNorm);
        const exportRequestId = peekExportTicketClaims(opts.exportTicket)?.export_request_id?.trim() ?? '';
        if (exportRequestId) {
          await rememberLocalPrintOrder({
            id: exportRequestId,
            createdAt: new Date().toISOString(),
            priceCents: opts.priceCents,
            status: 'printing',
            shippingName: '',
            bookId: pendingPayload.bookId || bookId,
            childId: pendingPayload.childId || childId,
            bookTitle: (pendingPayload.coverTitle || book?.title || '').trim(),
          });
        }
        await clearPendingPrintPayment();
        const pricePaid = opts.priceCents / 100;

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
          navigateToFinalizeMedia({
            pricePaidEuros: pricePaid,
            emailNorm: opts.emailNorm,
            exportTicket: opts.exportTicket,
          });
          return;
        }

        await clearPendingBookOrderPdfPayload();
        navigateToConfirmation({ pricePaidEuros: pricePaid, emailNorm: opts.emailNorm });
      } finally {
        fulfillLockRef.current = false;
        printFulfillInFlight = false;
      }
    },
    [book?.title, bookId, navigateToConfirmation, navigateToFinalizeMedia, subscriptionDb],
  );

  const applyPrintSubmitError = useCallback(
    (e: unknown) => {
      if (e instanceof Error && (e.message === 'PREP_NOT_READY' || e.message.startsWith('PREP_NOT_READY:'))) {
        setFieldErrors({ submit: 'Préparation des médias en cours. Attends quelques secondes puis réessaie.' });
      } else if (isDeviceStorageFullError(e)) {
        setFieldErrors({ submit: t('bookOrder.storageFull') });
      } else if (e instanceof Error && e.message === 'STRIPE_UNCONFIGURED') {
        setFieldErrors({ submit: t('bookOrder.payUnconfigured') });
      } else if (e instanceof Error && e.message === 'EXPORT_PAYMENT_REQUIRED') {
        setFieldErrors({ submit: t('bookOrder.payNotConfirmed') });
      } else if (e instanceof Error && /Invalid export ticket/i.test(e.message)) {
        setFieldErrors({ submit: t('bookOrder.payTicketExpired') });
      } else if (
        e instanceof Error &&
        (e.message.includes('not readable') || e.message.includes('renderAsync'))
      ) {
        setFieldErrors({
          submit:
            'Une photo du livre est introuvable sur cet appareil. Rouvre l’aperçu du livre, attends quelques secondes, puis réessaie.',
        });
      } else if (
        e instanceof Error &&
        /exceeded the maximum allowed size|PDF trop volumineux/i.test(e.message)
      ) {
        setFieldErrors({
          submit:
            'Le PDF du livre est trop volumineux pour le stockage (limite actuelle trop basse). ' +
            'Contacte le support ou réessaie après mise à jour des limites Storage (books-pdf).',
        });
      } else {
        setFieldErrors({ submit: e instanceof Error ? e.message : 'Échec de la commande.' });
      }
    },
    [t],
  );

  const submitOrder = useCallback(async () => {
    if (!bookId || !childId || !child) return;
    if (memoryPageCount < 1) {
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
    if (exportMode === 'print' && !contentVerified) {
      setFieldErrors({ submit: t('bookOrder.needVerify') });
      return;
    }
    setFieldErrors({});

    if (!isInitExportConfigured()) {
      setFieldErrors({ submit: 'Configuration Supabase (init-export) manquante.' });
      return;
    }

    const mail = email.trim().toLowerCase();
    const nowIso = new Date().toISOString();
    // Contact CRM : prénom/nom connu (préremplissage) sinon nom sur le colis.
    const contactFullName = fullName.trim() || shippingName.trim() || null;

    // V1 : pas de plafond 5+5 A/V — facturation QR au checkout uniquement.
    const pendingPayload = await getPendingBookOrderPdfPayload();

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
      submittingRef.current = true;
      try {
        if (!pendingPayload) {
          setFieldErrors({ submit: 'Aucun aperçu de livre chargé. Repasse par l’aperçu du livre.' });
          return;
        }

        const existingPay = await getPendingPrintPayment();
        let exportTicket = '';
        let exportRequestId = '';
        let priceCents = 0;

        const canReusePending =
          !!existingPay &&
          existingPay.bookId === bookId &&
          !isExportTicketExpired(existingPay.exportTicket);

        if (canReusePending && existingPay) {
          try {
            const st = await fetchPrintPaymentStatus(existingPay.exportTicket);
            if (st === 'paid') {
              await fulfillPrintAfterPaid({
                exportTicket: existingPay.exportTicket,
                emailNorm: mail,
                priceCents: existingPay.priceCents,
              });
              return;
            }
            exportTicket = existingPay.exportTicket;
            exportRequestId = existingPay.exportRequestId;
            priceCents = existingPay.priceCents;
          } catch {
            await clearPendingPrintPayment();
          }
        } else if (existingPay) {
          await clearPendingPrintPayment();
        }

        if (!exportTicket) {
          const payload = await withFreshBookPayloadForExport(pendingPayload);
          void getBookExportPrepIssues({
            pages: payload.pages,
            localEdits: payload.localEdits,
            coverPhotoUrl: payload.coverPhotoUrl,
            child: payload.child,
          });

          const gelatoPages = gelatoCatalogPageCount(payload.pages);
          const qrCount = payload.pages.filter(
            (p: { type: string }) => p.type === 'audio' || p.type === 'video',
          ).length;

          const res = await initPrintOrderExport({
            bookId,
            childLocalId: childId,
            subscriptionTierDb: subscriptionDb,
            audioVideoPageCount: qrCount,
            email: mail,
            gdprConsentAtIso: nowIso,
            contentVerifiedAtIso: nowIso,
            cgvVersion: PRINT_ORDER_CGV_VERSION,
            fullName: contactFullName,
            marketingOptIn: false,
            shippingName: shippingName.trim(),
            shippingAddress: {
              line1: line1.trim(),
              ...(line2.trim() ? { line2: line2.trim() } : {}),
              city: city.trim(),
              zip: zip.trim(),
              country,
            },
            gelatoPages,
            discountPercent,
            printerName: 'gelato',
          });
          exportTicket = res.exportTicket;
          exportRequestId = res.exportRequestId;
          priceCents = res.priceCents;
        }

        try {
          await setPendingExportUploadTicket(exportTicket, {
            exportRequestId,
            email: mail,
          });
        } catch {
          /* disk plein éventuel — finalize tentera encore */
        }
        await setPendingPrintPayment({
          exportRequestId,
          exportTicket,
          email: mail,
          priceCents,
          bookId,
          childId,
          createdAt: new Date().toISOString(),
        });

        setPrintPhase('paying');
        const returnUrl = ExpoLinking.createURL('book-order-return');
        const pay = await createPrintPayment({
          exportTicket,
          returnUrl,
          customerEmail: mail,
        });
        if (pay.paymentStatus === 'paid') {
          await fulfillPrintAfterPaid({ exportTicket, emailNorm: mail, priceCents });
          return;
        }
        if (!pay.checkoutUrl) {
          throw new Error(t('bookOrder.payOpenFailed'));
        }

        const st = await openPrintCheckoutAndWaitPaid({
          checkoutUrl: pay.checkoutUrl,
          exportTicket,
          onBrowserClosed: ({ canceled }) => {
            if (canceled) return;
            setPrintPhase('fulfilling');
            setSubmitting(true);
            submittingRef.current = true;
          },
        });
        if (st !== 'paid') {
          setFieldErrors({ submit: t('bookOrder.payNotConfirmed') });
          return;
        }
        setPrintPhase('fulfilling');
        await fulfillPrintAfterPaid({ exportTicket, emailNorm: mail, priceCents });
      } catch (e) {
        applyPrintSubmitError(e);
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
        setPrintPhase('idle');
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
      const payload = await withFreshBookPayloadForExport(pending);

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
          fullName: contactFullName,
          marketingOptIn: false,
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
      if (isDeviceStorageFullError(e)) {
        setFieldErrors({ submit: t('bookOrder.storageFull') });
      } else if (e instanceof Error && e.message === 'EXPORT_PAYMENT_REQUIRED') {
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
      } else if (
        e instanceof Error &&
        /exceeded the maximum allowed size|PDF trop volumineux/i.test(e.message)
      ) {
        setFieldErrors({
          submit:
            'Le PDF du livre est trop volumineux pour le stockage (limite actuelle trop basse). ' +
            'Contacte le support ou réessaie après mise à jour des limites Storage (books-pdf).',
        });
      } else {
        setFieldErrors({ submit: e instanceof Error ? e.message : 'Export impossible.' });
      }
    } finally {
      setSubmitting(false);
    }
  }, [
    bookId,
    child,
    childId,
    contentVerified,
    country,
    discountPercent,
    email,
    exportMode,
    fullName,
    getFieldErrors,
    line1,
    line2,
    memoryPageCount,
    navigateToConfirmation,
    navigateToFinalizeMedia,
    applyPrintSubmitError,
    fulfillPrintAfterPaid,
    router,
    shippingName,
    subscriptionDb,
    t,
    zip,
    city,
  ]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    if (exportMode !== 'print' || !bookId) return;

    const tryResumePaid = async (waitForPaid: boolean) => {
      if (printFulfillInFlight || fulfillLockRef.current) return;
      const pending = await getPendingPrintPayment();
      if (!pending || pending.bookId !== bookId) return;
      if (isExportTicketExpired(pending.exportTicket)) return;
      try {
        if (waitForPaid) {
          setSubmitting(true);
          submittingRef.current = true;
          setPrintPhase('fulfilling');
          const st = await waitUntilPrintPaid(pending.exportTicket, {
            attempts: 15,
            intervalMs: 1000,
          });
          if (st !== 'paid') {
            submittingRef.current = false;
            setSubmitting(false);
            setPrintPhase('idle');
            return;
          }
        } else {
          if (submittingRef.current) return;
          const st = await fetchPrintPaymentStatus(pending.exportTicket);
          if (st !== 'paid') return;
          setSubmitting(true);
          submittingRef.current = true;
        }
        await fulfillPrintAfterPaid({
          exportTicket: pending.exportTicket,
          emailNorm: pending.email,
          priceCents: pending.priceCents,
        });
      } catch (e) {
        applyPrintSubmitError(e);
        submittingRef.current = false;
        setSubmitting(false);
        setPrintPhase('idle');
      }
    };

    if (resumePayment) {
      void tryResumePaid(true);
    }

    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void tryResumePaid(false);
    });
    return () => sub.remove();
  }, [applyPrintSubmitError, bookId, exportMode, fulfillPrintAfterPaid, resumePayment]);

  if (!bookId || !childId) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + scale(12) }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backRow}>
          <Text style={[styles.backText, dm500 && { fontFamily: dm500 }]}>← Retour</Text>
        </Pressable>
        <Text style={[styles.title, dm700 && { fontFamily: dm700 }]}>{t('bookOrder.title')}</Text>
        <Text style={[styles.muted, dm500 && { fontFamily: dm500 }]}>
          Ouvre cette page depuis l’aperçu d’un livre (commande PDF ou impression).
        </Text>
      </View>
    );
  }

  if (loading) {
    if (resumePayment && exportMode === 'print') {
      return <BookPdfGeneratingView />;
    }
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

  const openCountryPicker = () => {
    Alert.alert(
      t('bookOrder.fieldCountry'),
      undefined,
      [
        ...COUNTRY_OPTIONS.map(o => ({
          text: o.label,
          onPress: () => setCountry(o.code),
        })),
        { text: 'Annuler', style: 'cancel' as const },
      ],
    );
  };

  const stickyCta = (
    <View style={[styles.stickyCtaWrap, { paddingBottom: Math.max(insets.bottom, scale(12)) }]}>
      <Pressable
        style={[
          petitmoCtaStyles.primary,
          petitmoCtaStyles.primaryFullWidth,
          styles.cta,
          styles.ctaOrderBlack,
          (submitting || !formIsComplete) && petitmoCtaStyles.primaryDisabled,
        ]}
        disabled={submitting || !formIsComplete}
        onPress={() => void submitOrder()}
        accessibilityRole="button"
        accessibilityLabel={ctaLabel}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text
            style={[
              petitmoCtaStyles.primaryText,
              styles.ctaText,
              styles.ctaOrderBlackText,
              dm700 && { fontFamily: dm700 },
            ]}
          >
            {ctaLabel}
          </Text>
        )}
      </Pressable>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: insets.top + scale(8),
            paddingBottom: scale(24),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backRow}>
          <Text style={[styles.backText, dm500 && { fontFamily: dm500 }]}>← Retour</Text>
        </Pressable>

        <Text style={[styles.title, dm700 && { fontFamily: dm700 }]}>
          {exportMode === 'print' ? t('bookOrder.title') : t('bookOrder.titlePdf')}
        </Text>
        {/* Pas de sous-titre : carte de résumé à côté de la cover */}

        {exportMode === 'print' ? (
          <View style={styles.summaryCard}>
            <View style={styles.summaryRow}>
              <View
                style={[
                  styles.coverClip,
                  {
                    width: BOOK_COVER_THUMB_WIDTH * ORDER_COVER_SCALE,
                    height: BOOK_COVER_THUMB_HEIGHT * ORDER_COVER_SCALE,
                  },
                ]}
              >
                <View
                  style={{
                    width: BOOK_COVER_THUMB_WIDTH,
                    height: BOOK_COVER_THUMB_HEIGHT,
                    transform: [{ scale: ORDER_COVER_SCALE }],
                    marginLeft:
                      -(BOOK_COVER_THUMB_WIDTH * (1 - ORDER_COVER_SCALE)) / 2,
                    marginTop:
                      -(BOOK_COVER_THUMB_HEIGHT * (1 - ORDER_COVER_SCALE)) / 2,
                  }}
                >
                  <BookCoverThumbnail
                    title={bookTitle || 'Mon livre'}
                    coverImageUri={coverUri}
                    coverPhotoCrop={coverCrop}
                    dateLabel={coverDateLabel}
                    coverColorId={book?.coverColorId}
                    imageRecyclingKey={`order-cover-${bookId}-${book?.coverPhotoUrl ?? ''}-${coverCropKey}-${book?.coverColorId ?? ''}`}
                    titleFontFamily={coverTitleFontFamily}
                    periodFontFamily={coverPeriodFontFamily}
                  />
                </View>
              </View>
              <View style={styles.summaryInfo}>
                <Text
                  style={[styles.summaryTitle, dm700 && { fontFamily: dm700 }]}
                  numberOfLines={2}
                >
                  {bookTitle || 'Ton livre'}
                </Text>
                <Text style={[styles.summaryMeta, dm500 && { fontFamily: dm500 }]}>
                  {pagesQrMeta}
                </Text>
                <Text style={[styles.summaryPrice, dm700 && { fontFamily: dm700 }]}>
                  {t('bookOrder.priceTtc', { price: priceLabel })}
                </Text>
                <Text style={[styles.summaryDelivery, dm500 && { fontFamily: dm500 }]}>
                  {t('bookOrder.deliveryIncluded')}
                </Text>
              </View>
            </View>
            <Pressable
              onPress={() => setPriceDetailOpen(v => !v)}
              hitSlop={8}
              style={styles.priceDetailLink}
              accessibilityRole="button"
              accessibilityLabel={
                priceDetailOpen ? t('bookOrder.hidePriceDetail') : t('bookOrder.seePriceDetail')
              }
            >
              <Text style={[styles.priceDetailLinkText, dm600 && { fontFamily: dm600 }]}>
                {priceDetailOpen ? t('bookOrder.hidePriceDetail') : t('bookOrder.seePriceDetail')}
                {' >'}
              </Text>
            </Pressable>
            {priceDetailOpen ? (
              <View style={styles.priceDetailBox}>
                <Text style={[styles.priceDetailLine, dm500 && { fontFamily: dm500 }]}>
                  Livre : {formatAppCurrency(printQuote.bookPartEuros, lang)}
                  {printQuote.extraPages > 0
                    ? ` (39 € + ${printQuote.extraPages} × 0,70 €)`
                    : ' (forfait 30 pages)'}
                </Text>
                {tier === 'free' ? (
                  <Text style={[styles.priceDetailLine, dm500 && { fontFamily: dm500 }]}>
                    QR audio/vidéo : {printQuote.qrCount} (
                    {PRINT_V1_INCLUDED_QR} inclus
                    {printQuote.extraQr > 0
                      ? ` + ${printQuote.extraQr} × 0,70 € = ${formatAppCurrency(printQuote.qrPartEuros, lang)}`
                      : ''}
                    )
                  </Text>
                ) : (
                  <Text style={[styles.priceDetailLine, dm500 && { fontFamily: dm500 }]}>
                    QR audio/vidéo : {printQuote.qrCount} · inclus Petit Cœur+
                  </Text>
                )}
                {tier === 'paid' ? (
                  <Text style={[styles.priceDetailLine, dm500 && { fontFamily: dm500 }]}>
                    Remise abonnée −10 % sur le livre
                  </Text>
                ) : null}
                {__DEV__ ? (
                  <Text style={[styles.priceDetailLine, { marginTop: 4 }]}>
                    Dev : Stripe test + Gelato draft (pas de colis réel).
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.summaryCard}>
            <Text style={[styles.summaryTitle, dm700 && { fontFamily: dm700 }]}>Livre PDF</Text>
            <Text style={[styles.summaryMeta, dm500 && { fontFamily: dm500 }]}>
              {pdfEntitled.premium || pdfEntitled.digitalPaid
                ? 'Inclus dans ton forfait ou achat actuel.'
                : 'Tarif hors forfait : l’achat est pris en compte au moment de la commande.'}
            </Text>
            <Text style={[styles.summaryPrice, dm700 && { fontFamily: dm700 }]}>
              {t('bookOrder.priceTtc', { price: priceLabel })}
            </Text>
            {prepHint ? (
              <Text style={[styles.err, { marginTop: 8 }]}>{prepHint}</Text>
            ) : null}
          </View>
        )}

        {exportMode === 'print' && tier === 'free' && printQuote.premiumUpsell ? (
          <Pressable
            style={styles.plusBanner}
            onPress={() =>
              router.push({ pathname: '/paywall', params: { context: 'BOOK_ORDER_DISCOUNT' } })
            }
            accessibilityRole="button"
            accessibilityLabel={t('bookOrder.discoverPlus')}
          >
            <Text style={[styles.plusSave, dm700 && { fontFamily: dm700 }]}>
              {t('bookOrder.plusSave', {
                savings: formatAppCurrency(printQuote.premiumUpsell.savingsEuros, lang),
              })}
            </Text>
            <Text style={[styles.plusPrice, dm500 && { fontFamily: dm500 }]}>
              {t('bookOrder.plusPrice', {
                price: formatAppCurrency(printQuote.premiumUpsell.totalEuros, lang),
              })}
            </Text>
            <Text style={[styles.plusLink, dm600 && { fontFamily: dm600 }]}>
              {t('bookOrder.discoverPlus')}
              {' >'}
            </Text>
          </Pressable>
        ) : null}

        {exportMode === 'print' && __DEV__ ? (
          <Pressable
            style={styles.devFillBtn}
            onPress={() => {
              const stamp = Date.now().toString(36);
              setEmail(`qa+gelato-${stamp}@example.com`);
              setEmailEditing(false);
              setShippingName('Test Petit Cœur Gelato');
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
            <Text style={[styles.section, dm600 && { fontFamily: dm600 }]}>
              {t('bookOrder.sectionDelivery')}
            </Text>
            <View style={styles.formCard}>
              <View style={styles.fieldBlock}>
                <Text style={[styles.fieldLabel, dm500 && { fontFamily: dm500 }]}>
                  {t('bookOrder.fieldFullName')}
                </Text>
                <TextInput
                  style={[
                    styles.fieldInput,
                    dm500 && { fontFamily: dm500 },
                    fieldErrors.shippingName && styles.inputError,
                  ]}
                  value={shippingName}
                  onChangeText={v => {
                    setShippingName(v);
                    clearError('shippingName');
                  }}
                  placeholder={t('bookOrder.fieldFullName')}
                  placeholderTextColor={THEME.textSecondary}
                />
              </View>
              {fieldErrors.shippingName ? (
                <Text style={styles.err}>{fieldErrors.shippingName}</Text>
              ) : null}

              <View style={styles.fieldDivider} />
              <View style={styles.fieldBlock}>
                <Text style={[styles.fieldLabel, dm500 && { fontFamily: dm500 }]}>
                  {t('bookOrder.fieldAddress')}
                </Text>
                <TextInput
                  style={[
                    styles.fieldInput,
                    dm500 && { fontFamily: dm500 },
                    fieldErrors.line1 && styles.inputError,
                  ]}
                  value={line1}
                  onChangeText={v => {
                    setLine1(v);
                    clearError('line1');
                  }}
                  placeholder={t('bookOrder.placeholderAddress')}
                  placeholderTextColor={THEME.textSecondary}
                />
              </View>
              {fieldErrors.line1 ? <Text style={styles.err}>{fieldErrors.line1}</Text> : null}

              <View style={styles.fieldDivider} />
              <View style={styles.fieldBlock}>
                <Text style={[styles.fieldLabel, dm500 && { fontFamily: dm500 }]}>
                  {t('bookOrder.fieldAddress2')}
                </Text>
                <TextInput
                  style={[styles.fieldInput, dm500 && { fontFamily: dm500 }]}
                  value={line2}
                  onChangeText={setLine2}
                  placeholder={t('bookOrder.placeholderAddress2')}
                  placeholderTextColor={THEME.textSecondary}
                />
              </View>

              <View style={styles.fieldDivider} />
              <View style={styles.row2}>
                <View style={[styles.grow, styles.fieldBlock]}>
                  <Text style={[styles.fieldLabel, dm500 && { fontFamily: dm500 }]}>
                    {t('bookOrder.fieldZip')}
                  </Text>
                  <TextInput
                    style={[
                      styles.fieldInput,
                      dm500 && { fontFamily: dm500 },
                      fieldErrors.zip && styles.inputError,
                    ]}
                    value={zip}
                    onChangeText={v => {
                      setZip(v);
                      clearError('zip');
                    }}
                    placeholder={t('bookOrder.fieldZip')}
                    placeholderTextColor={THEME.textSecondary}
                    keyboardType="numbers-and-punctuation"
                  />
                  {fieldErrors.zip ? <Text style={styles.err}>{fieldErrors.zip}</Text> : null}
                </View>
                <View style={styles.colDivider} />
                <View style={[styles.grow2, styles.fieldBlock]}>
                  <Text style={[styles.fieldLabel, dm500 && { fontFamily: dm500 }]}>
                    {t('bookOrder.fieldCity')}
                  </Text>
                  <TextInput
                    style={[
                      styles.fieldInput,
                      dm500 && { fontFamily: dm500 },
                      fieldErrors.city && styles.inputError,
                    ]}
                    value={city}
                    onChangeText={v => {
                      setCity(v);
                      clearError('city');
                    }}
                    placeholder={t('bookOrder.fieldCity')}
                    placeholderTextColor={THEME.textSecondary}
                  />
                  {fieldErrors.city ? <Text style={styles.err}>{fieldErrors.city}</Text> : null}
                </View>
              </View>

              <View style={styles.fieldDivider} />
              <Pressable
                style={styles.countryRow}
                onPress={openCountryPicker}
                accessibilityRole="button"
                accessibilityLabel={t('bookOrder.fieldCountry')}
              >
                <View style={styles.fieldBlockGrow}>
                  <Text style={[styles.fieldLabel, dm500 && { fontFamily: dm500 }]}>
                    {t('bookOrder.fieldCountry')}
                  </Text>
                  <Text style={[styles.fieldValue, dm500 && { fontFamily: dm500 }]}>
                    {countryLabel}
                  </Text>
                </View>
                <ChevronRight size={scale(18)} color={THEME.textSecondary} strokeWidth={2} />
              </Pressable>
            </View>

            <View style={[styles.formCard, styles.emailCard]}>
              <View style={styles.emailHeader}>
                <Text style={[styles.fieldLabel, dm500 && { fontFamily: dm500 }]}>
                  {t('bookOrder.fieldEmail')}
                </Text>
                {showEmailDisplay ? (
                  <Pressable onPress={() => setEmailEditing(true)} hitSlop={8}>
                    <Text style={[styles.emailEdit, dm600 && { fontFamily: dm600 }]}>
                      {t('bookOrder.emailEdit')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {showEmailDisplay ? (
                <Text style={[styles.fieldValue, dm500 && { fontFamily: dm500 }]} numberOfLines={1}>
                  {email.trim()}
                </Text>
              ) : (
                <TextInput
                  style={[
                    styles.fieldInput,
                    dm500 && { fontFamily: dm500 },
                    fieldErrors.email && styles.inputError,
                  ]}
                  value={email}
                  onChangeText={v => {
                    setEmail(v);
                    clearError('email');
                  }}
                  onBlur={() => {
                    if (isValidEmail(email)) setEmailEditing(false);
                  }}
                  placeholder="email@exemple.com"
                  placeholderTextColor={THEME.textSecondary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus={emailEditing}
                />
              )}
              {fieldErrors.email ? <Text style={styles.err}>{fieldErrors.email}</Text> : null}
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.section, dm600 && { fontFamily: dm600 }]}>
              {t('bookOrder.fieldEmail')}
            </Text>
            <View style={styles.formCard}>
              <TextInput
                style={[
                  styles.fieldInput,
                  dm500 && { fontFamily: dm500 },
                  fieldErrors.email && styles.inputError,
                ]}
                value={email}
                onChangeText={v => {
                  setEmail(v);
                  clearError('email');
                }}
                placeholder="email@exemple.com"
                placeholderTextColor={THEME.textSecondary}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              {fieldErrors.email ? <Text style={styles.err}>{fieldErrors.email}</Text> : null}
            </View>
          </>
        )}

        {exportMode === 'print' ? (
          <>
            <Text style={[styles.section, dm600 && { fontFamily: dm600 }]}>
              {t('bookOrder.sectionBeforeOrder')}
            </Text>
            <View style={styles.formCard}>
              <Pressable
                style={styles.reviewRow}
                onPress={() => {
                  if (!bookId) return;
                  router.push({
                    pathname: '/book-preview',
                    params: { bookId, fromOrderReview: '1' },
                  });
                }}
                accessibilityRole="button"
                accessibilityLabel={t('bookOrder.reviewBook')}
              >
                <Text style={[styles.reviewRowText, dm500 && { fontFamily: dm500 }]}>
                  {t('bookOrder.reviewBook')}
                </Text>
                <ChevronRight size={scale(18)} color={THEME.textSecondary} strokeWidth={2} />
              </Pressable>

              <View style={styles.fieldDivider} />

              <Pressable
                style={styles.checkRow}
                onPress={() => {
                  setContentVerified(v => !v);
                  clearError('submit');
                }}
                hitSlop={4}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: contentVerified }}
              >
                <View style={[styles.checkbox, contentVerified && styles.checkboxOn]}>
                  {contentVerified ? (
                    <Text style={styles.checkboxMark}>✓</Text>
                  ) : null}
                </View>
                <Text style={[styles.checkLabel, dm500 && { fontFamily: dm500 }]}>
                  {t('bookOrder.legalCheckbox')}
                </Text>
              </Pressable>

              <View style={styles.fieldDivider} />

              <Text style={[styles.legalBody, dm500 && { fontFamily: dm500 }]}>
                {t('bookOrder.legalBody')}
                <Text
                  style={[styles.legalCgvLink, dm600 && { fontFamily: dm600 }]}
                  onPress={() => void Linking.openURL(PRINT_ORDER_CGV_URL)}
                >
                  {t('bookOrder.legalCgvLink')}
                </Text>
                .
              </Text>
            </View>
          </>
        ) : null}

        {fieldErrors.submit ? <Text style={styles.err}>{fieldErrors.submit}</Text> : null}
      </ScrollView>

      {stickyCta}

      <BookPdfGeneratingOverlay
        visible={submitting && (exportMode === 'pdf' || printPhase === 'fulfilling')}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: THEME.bgScreen },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.bgScreen,
  },
  root: { flex: 1, backgroundColor: THEME.bgScreen, paddingHorizontal: scale(20) },
  scroll: { paddingHorizontal: scale(20) },
  backRow: { marginBottom: scale(10), alignSelf: 'flex-start' },
  backText: { fontSize: scale(16), color: THEME.textPrimary, fontWeight: '600' },
  title: {
    fontSize: scale(26),
    fontWeight: '700',
    color: THEME.textPrimary,
    marginBottom: scale(4),
  },
  sub: { fontSize: scale(15), color: THEME.textMuted, marginBottom: scale(18) },
  muted: { fontSize: scale(15), color: THEME.textMuted, marginTop: scale(12) },

  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: scale(16),
    padding: scale(14),
    marginBottom: scale(12),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  summaryRow: { flexDirection: 'row', gap: scale(14), alignItems: 'flex-start' },
  coverClip: {
    overflow: 'hidden',
    borderRadius: scale(8),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.1)',
    backgroundColor: '#FFFFFF',
  },
  summaryInfo: { flex: 1, minWidth: 0, paddingTop: scale(2) },
  summaryTitle: {
    fontSize: scale(17),
    fontWeight: '700',
    color: THEME.textPrimary,
    marginBottom: scale(4),
  },
  summaryMeta: {
    fontSize: scale(13),
    color: THEME.textMuted,
    marginBottom: scale(10),
  },
  summaryPrice: {
    fontSize: scale(22),
    fontWeight: '700',
    color: THEME.textPrimary,
  },
  summaryDelivery: {
    fontSize: scale(14),
    color: THEME.textPrimary,
    marginTop: scale(2),
  },
  priceDetailLink: {
    alignSelf: 'flex-end',
    marginTop: scale(10),
  },
  priceDetailLinkText: {
    fontSize: scale(14),
    fontWeight: '600',
    color: THEME.brandCtaOrange,
  },
  priceDetailBox: {
    marginTop: scale(10),
    paddingTop: scale(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.08)',
    gap: scale(4),
  },
  priceDetailLine: {
    fontSize: scale(13),
    color: THEME.textMuted,
    lineHeight: scale(18),
  },

  plusBanner: {
    backgroundColor: 'rgba(253, 119, 100, 0.10)',
    borderRadius: scale(14),
    paddingVertical: scale(12),
    paddingHorizontal: scale(14),
    marginBottom: scale(16),
  },
  plusSave: {
    fontSize: scale(15),
    fontWeight: '700',
    color: THEME.textPrimary,
    marginBottom: scale(2),
  },
  plusPrice: {
    fontSize: scale(13),
    color: THEME.textMuted,
    marginBottom: scale(4),
  },
  plusLink: {
    fontSize: scale(17),
    fontWeight: '600',
    lineHeight: scale(22),
    color: THEME.brandCtaOrange,
  },

  section: {
    fontSize: scale(12),
    fontWeight: '700',
    color: THEME.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: scale(8),
    marginTop: scale(4),
  },
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: scale(16),
    paddingHorizontal: scale(14),
    paddingVertical: scale(4),
    marginBottom: scale(14),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  emailCard: {
    paddingVertical: scale(12),
  },
  fieldBlock: {
    paddingVertical: scale(10),
  },
  fieldBlockGrow: { flex: 1, minWidth: 0, paddingVertical: scale(10) },
  fieldLabel: {
    fontSize: scale(12),
    color: THEME.textMuted,
    marginBottom: scale(4),
  },
  fieldInput: {
    fontSize: scale(16),
    color: THEME.textPrimary,
    paddingVertical: Platform.OS === 'ios' ? scale(2) : 0,
    margin: 0,
  },
  fieldValue: {
    fontSize: scale(16),
    color: THEME.textPrimary,
  },
  fieldDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  colDivider: {
    width: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.08)',
    marginVertical: scale(8),
  },
  row2: { flexDirection: 'row', alignItems: 'stretch' },
  grow: { flex: 1, minWidth: 0 },
  grow2: { flex: 1.35, minWidth: 0 },
  countryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(8),
  },
  emailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: scale(2),
  },
  emailEdit: {
    fontSize: scale(14),
    fontWeight: '600',
    color: THEME.brandCtaOrange,
  },

  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: scale(14),
  },
  reviewRowText: {
    flex: 1,
    fontSize: scale(15),
    color: THEME.textPrimary,
    paddingRight: scale(8),
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: scale(12),
    paddingVertical: scale(12),
  },
  checkbox: {
    width: scale(22),
    height: scale(22),
    borderRadius: scale(5),
    borderWidth: 1.5,
    borderColor: THEME.textSecondary,
    marginTop: scale(1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    backgroundColor: THEME.brandCtaOrange,
    borderColor: THEME.captureCtaBorderColor,
  },
  checkboxMark: {
    color: THEME.captureScreenCtaForeground,
    fontSize: scale(13),
    fontWeight: '700',
    lineHeight: scale(16),
  },
  checkLabel: {
    flex: 1,
    fontSize: scale(14),
    color: THEME.textPrimary,
    lineHeight: scale(20),
  },
  legalBody: {
    fontSize: scale(12),
    color: THEME.textMuted,
    lineHeight: scale(17),
    paddingVertical: scale(12),
  },
  legalCgvLink: {
    fontSize: scale(12),
    color: THEME.brandCtaOrange,
    fontWeight: '600',
  },

  inputError: { color: '#B91C1C' },
  err: {
    fontSize: scale(13),
    color: 'rgba(180, 60, 60, 0.9)',
    marginBottom: scale(8),
    marginTop: scale(2),
  },
  stickyCtaWrap: {
    paddingHorizontal: scale(20),
    paddingTop: scale(10),
    backgroundColor: THEME.bgScreen,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.06)',
  },
  cta: {
    marginTop: 0,
  },
  ctaOrderBlack: {
    backgroundColor: CAPTURE_CTA_BORDER,
    borderColor: CAPTURE_CTA_BORDER,
    borderWidth: PETITMO_CTA_BORDER_WIDTH,
  },
  ctaOrderBlackText: {
    color: '#FFFFFF',
  },
  ctaText: {
    fontSize: scale(16),
  },
  devFillBtn: {
    alignSelf: 'flex-start',
    marginBottom: scale(12),
    paddingVertical: scale(8),
    paddingHorizontal: scale(12),
    borderRadius: scale(8),
    backgroundColor: 'rgba(37, 99, 235, 0.12)',
  },
  devFillBtnText: { fontSize: scale(13), fontWeight: '600', color: '#1D4ED8' },
});
