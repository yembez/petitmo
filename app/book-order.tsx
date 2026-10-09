import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  Keyboard,
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
import { getUserTier, peekUserTier } from '@/lib/userTier';
import { getLastGuestExportEmail, setLastGuestExportEmail } from '@/lib/guestExportPrefs';
import {
  getLastPrintOrderForm,
  peekLastPrintOrderForm,
  setLastPrintOrderForm,
} from '@/lib/printOrderFormPrefs';
import { PRINT_V1_INCLUDED_QR, quotePrintOrderV1 } from '@/lib/pricingV1';
import { isSentryEnabled, Sentry } from '@/lib/sentry';
import { PRINT_V1_PAID_DISCOUNT_PERCENT, type DiscountPercent } from '@/lib/printedBookQuote';
import { PRINT_ORDER_CGV_URL, PRINT_ORDER_CGV_VERSION } from '@/lib/printOrderLegal';
import {
  getBook,
  resolveBookCoverPrintUri,
  resolveBookListRowCoverUri,
  type Book,
} from '@/services/books';
import { listLocalChildren, listLocalChildrenForUser } from '@/lib/localDb';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import { getChildren } from '@/services/children';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { printBreadcrumb, printCaptureError, printCaptureMessage } from '@/lib/printFlowSentry';
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
  stashPrintBookPayloadWithExportTicket,
  collectMemoriesFromPagesForPdf,
  refreshBookPdfPagesMemoriesFromSqlite,
  type GenerateBookPdfServerInput,
} from '@/services/bookPdfServer';
import { BookPdfGeneratingOverlay } from '@/components/BookPdfGeneratingOverlay';
import { StableTextInput } from '@/components/StableTextInput';
import { getFrenchCommunesForPostalCode, isFrenchPostalCode } from '@/services/frenchCommunes';
import { finishPrintStashAndKickIfNeeded, trackPrintStashPromise } from '@/services/finishPrintAfterPaid';
import { getCityHint, uniqueCommuneForAutofill } from '@/utils/cityMatch';
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
  markPendingPrintPaymentStashed,
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
import { getEmailHint } from '@/utils/emailSanity';
import { peekRealAuthEmail } from '@/lib/authAccount';

WebBrowser.maybeCompleteAuthSession();

/** Empêche un double post-pay (deep link + AppState) pendant la confirmation. */
let printFulfillInFlight = false;

/** Ticket print (init-export) + prix figé — partagé entre Checkout et stash en fond. */
type PrintTicketInfo = {
  exportTicket: string;
  exportRequestId: string;
  priceCents: number;
};

/** Miniature couverture carte commande — même composant que l’onglet Livres, un cran plus petit. */
const ORDER_COVER_SCALE = 0.78;

const COUNTRY_OPTIONS = [
  { code: 'FR' as const, label: 'France' },
  { code: 'BE' as const, label: 'Belgique' },
  { code: 'CH' as const, label: 'Suisse' },
  { code: 'LU' as const, label: 'Luxembourg' },
] as const;

type CountryCode = (typeof COUNTRY_OPTIONS)[number]['code'];

/** Champs texte libres du formulaire (miroir synchrone `liveFormRef`). */
type LiveTextField = 'email' | 'fullName' | 'shippingName' | 'line1' | 'line2' | 'city' | 'zip';

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
): {
  line1: string;
  line2: string;
  city: string;
  zip: string;
  country: CountryCode;
  shippingName: string;
} | null {
  if (j == null || typeof j !== 'object' || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  const line1 = typeof o.line1 === 'string' ? o.line1 : '';
  const line2 = typeof o.line2 === 'string' ? o.line2 : '';
  const city = typeof o.city === 'string' ? o.city : '';
  const zip = typeof o.zip === 'string' ? o.zip : '';
  const shippingName = typeof o.shipping_name === 'string' ? o.shipping_name.trim() : '';
  const rawC = typeof o.country === 'string' ? o.country.toUpperCase() : '';
  const isCountry = (c: string): c is CountryCode => COUNTRY_OPTIONS.some(x => x.code === c);
  const country: CountryCode = isCountry(rawC) ? rawC : 'FR';
  if (!line1.trim() || !city.trim() || !zip.trim()) return null;
  return { line1: line1.trim(), line2, city: city.trim(), zip: zip.trim(), country, shippingName };
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

  /** Si cache form déjà en mémoire : peindre le formulaire tout de suite (pas d’écran spinner). */
  const [loading, setLoading] = useState(() => !peekLastPrintOrderForm());
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
  /**
   * `opening` = init-export + session Stripe (≈2 s) · `staging` = upload bloquant avant paiement
   * (rare : prefetch en échec) · `finishing` = reprise paid brève (confirm part immédiatement).
   */
  const [printPhase, setPrintPhase] = useState<
    'idle' | 'opening' | 'staging' | 'checking' | 'finishing'
  >('idle');
  /** Messages progressifs pendant chargement formulaire / finalisation post-pay. */
  const [waitMsgStep, setWaitMsgStep] = useState(0);
  const fulfillLockRef = useRef(false);
  const submittingRef = useRef(false);
  /** Ticket print (init-export) pour l’empreinte adresse courante — obtenu avant le Checkout. */
  const printTicketRef = useRef<(PrintTicketInfo & { fingerprint: string }) | null>(null);
  const printTicketInFlightRef = useRef<Promise<PrintTicketInfo> | null>(null);
  /** Stash serveur (médias + pages) terminé pour ce ticket — l’upload tourne pendant le Checkout. */
  const printStashReadyRef = useRef<(PrintTicketInfo & { fingerprint: string }) | null>(null);
  const printStashInFlightRef = useRef<{ exportTicket: string; promise: Promise<PrintTicketInfo> } | null>(
    null,
  );
  /** Dernier échec de stash en fond (prefetch) → on bloque avant paiement plutôt qu’après. */
  const printStashErrorRef = useRef<{ exportTicket: string; error: unknown } | null>(null);
  const [pdfEntitled, setPdfEntitled] = useState({ premium: false, digitalPaid: false });
  const [blockedEmptyMemories, setBlockedEmptyMemories] = useState(false);
  const emptyBookAlertShownRef = useRef(false);
  const [prepHint, setPrepHint] = useState<string | null>(null);
  const [priceDetailOpen, setPriceDetailOpen] = useState(false);
  const [emailEditing, setEmailEditing] = useState(false);

  /** Prefill synchrone (mémoire) — évite formulaire vide puis « pop » AsyncStorage/CRM. */
  const seedForm = peekLastPrintOrderForm();
  const [email, setEmail] = useState(seedForm?.email ?? '');
  const [fullName, setFullName] = useState(seedForm?.fullName ?? '');
  /** Case légale impression — décochée par défaut. */
  const [contentVerified, setContentVerified] = useState(false);
  const [shippingName, setShippingName] = useState(seedForm?.shippingName ?? '');
  const [line1, setLine1] = useState(seedForm?.line1 ?? '');
  const [line2, setLine2] = useState(seedForm?.line2 ?? '');
  const [city, setCity] = useState(seedForm?.city ?? '');
  const [zip, setZip] = useState(seedForm?.zip ?? '');
  const [country, setCountry] = useState<CountryCode>(() => {
    const c = (seedForm?.country ?? 'FR').toUpperCase();
    return COUNTRY_OPTIONS.some(x => x.code === c) ? (c as CountryCode) : 'FR';
  });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({});

  /**
   * « Vérité clavier » : valeurs texte **synchrones** (chaque frappe via `onChangeTextImmediate`,
   * et chaque mise à jour programmatique via `applyField`). L’état React ci-dessus sert à
   * l’affichage et peut avoir ~160 ms de retard (`StableTextInput`) : le submit lit **cette ref**,
   * jamais l’état — c’est ce qui part au serveur / Gelato.
   */
  const liveFormRef = useRef<Record<LiveTextField, string>>({
    email: seedForm?.email ?? '',
    fullName: seedForm?.fullName ?? '',
    shippingName: seedForm?.shippingName ?? '',
    line1: seedForm?.line1 ?? '',
    line2: seedForm?.line2 ?? '',
    city: seedForm?.city ?? '',
    zip: seedForm?.zip ?? '',
  });
  const liveSetters = useRef<Record<LiveTextField, (v: string) => void>>({
    email: setEmail,
    fullName: setFullName,
    shippingName: setShippingName,
    line1: setLine1,
    line2: setLine2,
    city: setCity,
    zip: setZip,
  });
  const applyField = useCallback((k: LiveTextField, v: string) => {
    liveFormRef.current[k] = v;
    liveSetters.current[k](v);
  }, []);
  const readLiveForm = useCallback(() => {
    const f = liveFormRef.current;
    return {
      email: f.email.trim().toLowerCase(),
      fullName: f.fullName.trim(),
      shippingName: f.shippingName.trim(),
      line1: f.line1.trim(),
      line2: f.line2.trim(),
      city: f.city.trim(),
      zip: f.zip.trim(),
    };
  }, []);

  /** Communes du code postal saisi (France) — hint ville + préremplissage silencieux. */
  const [zipCommunes, setZipCommunes] = useState<{ zip: string; names: string[] } | null>(null);

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

  /**
   * Local-first : peindre SQLite + e-mail local **avant** tout pull cloud / CRM.
   * `getChildren()` + `fetchCrmPrefillByEmail` tournent en fond (Low Friction).
   */
  useEffect(() => {
    void (async () => {
      if (!bookId || !childId) {
        setLoading(false);
        return;
      }
      try {
        const scopeUid = (peekLastRealAuthUserId() ?? '').trim();
        const localKids = scopeUid
          ? listLocalChildrenForUser(scopeUid)
          : listLocalChildren();
        const localChild = localKids.find(c => c.id === childId) ?? null;
        if (localChild) setChild(localChild);

        const [book, t, tLast, localForm] = await Promise.all([
          getBook(bookId),
          getUserTier(),
          getLastGuestExportEmail(),
          getLastPrintOrderForm(),
        ]);
        setTier(t);
        if (book) setBook(book);

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

        // Prefill local immédiat (avant paint) — CRM en fond ne fait que combler les vides.
        const startEmail = (localForm?.email || tLast || '').trim().toLowerCase();
        if (startEmail) {
          applyField('email', startEmail);
          setEmailEditing(false);
        }
        if (localForm) {
          if (localForm.fullName && !liveFormRef.current.fullName.trim()) {
            applyField('fullName', localForm.fullName);
          }
          if (localForm.shippingName && !liveFormRef.current.shippingName.trim()) {
            applyField('shippingName', localForm.shippingName);
          }
          if (
            !liveFormRef.current.line1.trim() &&
            !liveFormRef.current.city.trim() &&
            !liveFormRef.current.zip.trim()
          ) {
            if (localForm.line1) applyField('line1', localForm.line1);
            if (localForm.line2) applyField('line2', localForm.line2);
            if (localForm.city) applyField('city', localForm.city);
            if (localForm.zip) applyField('zip', localForm.zip);
            if (localForm.country) setCountry(localForm.country);
          }
        }

        // Formulaire visible tout de suite — pas d’attente réseau.
        setLoading(false);
        printBreadcrumb('print.form.painted_local', {
          bookId,
          childId,
          hasLocalForm: !!localForm,
        });

        // Fond : entitlements + enfants cloud + CRM (n’écrase jamais une saisie en cours).
        void resolveServerPdfEntitlements()
          .then(ent => {
            setPdfEntitled({
              premium: ent.subscriptionTier === 'premium',
              digitalPaid: ent.digitalExportPaid,
            });
          })
          .catch(() => undefined);

        void getChildren()
          .then(children => {
            const ch = children.find(c => c.id === childId) ?? null;
            if (ch) setChild(ch);
          })
          .catch(() => undefined);

        if (startEmail) {
          void fetchCrmPrefillByEmail(startEmail)
            .then(pre => {
              if (!pre) return;
              if (pre.full_name) {
                if (!liveFormRef.current.fullName.trim()) {
                  applyField('fullName', pre.full_name);
                }
                if (!liveFormRef.current.shippingName.trim()) {
                  applyField('shippingName', pre.full_name.trim());
                }
              }
              const addr = pickAddressFromJson(
                pre.address_json && typeof pre.address_json === 'object'
                  ? pre.address_json
                  : null,
              );
              if (!addr) return;
              const live = liveFormRef.current;
              if (!live.line1.trim() && !live.city.trim() && !live.zip.trim()) {
                applyField('line1', addr.line1);
                applyField('line2', addr.line2);
                applyField('city', addr.city);
                applyField('zip', addr.zip);
                setCountry(addr.country);
                if (addr.shippingName && !live.shippingName.trim()) {
                  applyField('shippingName', addr.shippingName);
                }
              }
            })
            .catch(() => undefined);
        }
      } catch {
        setLoading(false);
      }
    })();
  }, [applyField, bookId, childId, memoryPageCountParam, router]);

  /** Messages progressifs si le paint local traîne ou pendant la finalisation post-pay. */
  useEffect(() => {
    const rotating =
      loading || (exportMode === 'print' && submitting && printPhase === 'finishing');
    if (!rotating) {
      setWaitMsgStep(0);
      return;
    }
    setWaitMsgStep(0);
    const id = setInterval(() => {
      setWaitMsgStep(s => Math.min(s + 1, 2));
    }, 4500);
    return () => clearInterval(id);
  }, [exportMode, loading, printPhase, submitting]);

  /** Overlay « Ton livre prend vie » : fermer le clavier (reprise paid / focus champ). */
  useEffect(() => {
    if (exportMode === 'print' && submitting) {
      Keyboard.dismiss();
    }
  }, [exportMode, submitting, printPhase]);

  /**
   * Au focus : relit le tier (retour paywall → −10 % immédiat) +
   * recalcule pages / QR / prix depuis le pending rafraîchi (revue livre).
   */
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      // Sync immédiat (mémoire RC/paywall) puis confirm AsyncStorage — −10 % sans quitter l’écran.
      setTier(peekUserTier());
      void (async () => {
        try {
          const t = await getUserTier();
          if (alive) setTier(t);
        } catch {
          /* ignore */
        }
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
    // Vérité clavier (pas l’état React, qui peut avoir une frappe de retard au tap Commander).
    const f = readLiveForm();
    if (!f.email) e.email = 'Requis';
    else if (!isValidEmail(f.email)) e.email = 'Email invalide';

    if (exportMode === 'print') {
      if (!f.shippingName) e.shippingName = 'Nom sur le colis requis';
      if (!f.line1) e.line1 = 'Adresse requise';
      if (!f.city) e.city = 'Ville requise';
      if (!f.zip) e.zip = 'Code postal requis';
    }
    return e;
  }, [exportMode, readLiveForm]);

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

  /**
   * Empreinte ticket / stash : livre + e-mail + remise seulement.
   * L’adresse **n’y figure plus** : elle est figée au Checkout (`createPrintPayment`), pas à
   * l’init-export. Sinon chaque frappe (« Mont » → « Montpellier ») invalidait le prefetch,
   * relançait l’upload, et après paiement l’overlay attendait tout l’upload d’un coup.
   * Ne pas inclure `contentVerified` non plus (même piège sur la case légale).
   */
  const printFormFingerprint = useCallback(() => {
    return [bookId, childId, email.trim().toLowerCase(), String(discountPercent)].join('\0');
  }, [bookId, childId, discountPercent, email]);

  /** Assez d’infos pour init-export + stash en fond (sans attendre la case légale). */
  const printAddressReady = useMemo(() => {
    if (exportMode !== 'print') return false;
    return (
      email.trim().length > 0 &&
      isValidEmail(email) &&
      shippingName.trim().length > 0 &&
      line1.trim().length > 0 &&
      city.trim().length > 0 &&
      zip.trim().length > 0
    );
  }, [city, email, exportMode, line1, shippingName, zip]);

  /**
   * Étape 1 — ticket print (init-export) : un seul aller-retour Edge, prix figé.
   * Réutilise un pending non expiré (même livre) ; sinon crée la demande.
   * Ne lance **pas** l’upload : le Checkout doit s’ouvrir sans attendre les photos.
   */
  const ensurePrintTicket = useCallback(async (): Promise<PrintTicketInfo> => {
    const fingerprint = printFormFingerprint();
    const cached = printTicketRef.current;
    if (cached && cached.fingerprint === fingerprint && !isExportTicketExpired(cached.exportTicket)) {
      return {
        exportTicket: cached.exportTicket,
        exportRequestId: cached.exportRequestId,
        priceCents: cached.priceCents,
      };
    }
    if (printTicketInFlightRef.current) {
      return await printTicketInFlightRef.current;
    }

    const run = (async (): Promise<PrintTicketInfo> => {
      const pendingPayload = await getPendingBookOrderPdfPayload();
      if (!pendingPayload) {
        throw new Error('Aucun aperçu de livre chargé. Repasse par l’aperçu du livre.');
      }
      const catalogPagesForGelato = gelatoCatalogPageCount(pendingPayload.pages);
      if (catalogPagesForGelato < GELATO_MIN_INNER_PAGES) {
        throw new Error(gelatoMinInnerPagesAlertMessage(gelatoInnerPageCount(pendingPayload.pages)));
      }

      // Vérité clavier : l’état `email` peut avoir une frappe de retard.
      const mail = readLiveForm().email || email.trim().toLowerCase();
      let info: PrintTicketInfo | null = null;
      let reusedStashed = false;

      // Le ticket est rattaché au contact CRM (e-mail) : un pending avec un autre e-mail n’est
      // pas réutilisable. L’adresse, elle, est re-figée au Checkout (`createPrintPayment`).
      const existingPay = await getPendingPrintPayment();
      if (
        existingPay &&
        existingPay.bookId === bookId &&
        existingPay.email === mail &&
        !isExportTicketExpired(existingPay.exportTicket)
      ) {
        try {
          const st = await fetchPrintPaymentStatus(existingPay.exportTicket);
          // Un ticket **paid** n’est pas un ticket Checkout : reprise via `completePrintAfterPaid`.
          // Le réutiliser ici empêchait toute nouvelle commande et fake-confirmait sans Gelato.
          if (st === 'paid') {
            printBreadcrumb('print.ticket.skip_paid_reuse', {
              exportRequestId: existingPay.exportRequestId,
            });
            throw new Error('PRINT_ALREADY_PAID');
          }
          if (st === 'unpaid') {
            info = {
              exportTicket: existingPay.exportTicket,
              exportRequestId: existingPay.exportRequestId,
              priceCents: existingPay.priceCents,
            };
            reusedStashed = existingPay.stashed === true;
          }
        } catch (e) {
          if (e instanceof Error && e.message === 'PRINT_ALREADY_PAID') throw e;
          await clearPendingPrintPayment();
        }
      }

      if (!info) {
        const nowIso = new Date().toISOString();
        const contactFullName = fullName.trim() || shippingName.trim() || null;
        const gelatoPages = catalogPagesForGelato;
        const qrCount = pendingPayload.pages.filter(
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
        info = {
          exportTicket: res.exportTicket,
          exportRequestId: res.exportRequestId,
          priceCents: res.priceCents,
        };
      }

      try {
        await setPendingExportUploadTicket(info.exportTicket, {
          exportRequestId: info.exportRequestId,
          email: mail,
        });
      } catch {
        /* ignore */
      }
      await setPendingPrintPayment({
        exportRequestId: info.exportRequestId,
        exportTicket: info.exportTicket,
        email: mail,
        priceCents: info.priceCents,
        bookId,
        childId,
        createdAt: new Date().toISOString(),
        stashed: reusedStashed,
      });

      printTicketRef.current = { fingerprint, ...info };
      return info;
    })();

    printTicketInFlightRef.current = run;
    try {
      return await run;
    } finally {
      printTicketInFlightRef.current = null;
    }
  }, [
    bookId,
    childId,
    city,
    country,
    discountPercent,
    email,
    fullName,
    line1,
    line2,
    printFormFingerprint,
    readLiveForm,
    shippingName,
    subscriptionDb,
    zip,
  ]);

  /**
   * Étape 2 — upload médias + stash serveur pour un ticket donné.
   * Dédupliqué (prefetch fond / Checkout / reprise). Tourne **pendant** le Checkout Stripe ;
   * `completePrintAfterPaid` attend seulement le reliquat.
   */
  const runPrintStash = useCallback(
    async (ticket: PrintTicketInfo): Promise<PrintTicketInfo> => {
      const ready = printStashReadyRef.current;
      if (ready && ready.exportTicket === ticket.exportTicket) return ticket;
      const inFlight = printStashInFlightRef.current;
      if (inFlight && inFlight.exportTicket === ticket.exportTicket) {
        return await inFlight.promise;
      }

      const run = (async (): Promise<PrintTicketInfo> => {
        const pendingPayload = await getPendingBookOrderPdfPayload();
        if (!pendingPayload) {
          throw new Error('Aucun aperçu de livre chargé. Repasse par l’aperçu du livre.');
        }
        const payload = await withFreshBookPayloadForExport(pendingPayload);
        void getBookExportPrepIssues({
          pages: payload.pages,
          localEdits: payload.localEdits,
          coverPhotoUrl: payload.coverPhotoUrl,
          child: payload.child,
        });

        const subscriptionTierPdf = subscriptionDb === 'paid' ? 'premium' : 'free';
        await stashPrintBookPayloadWithExportTicket({
          ...payload,
          exportMode: 'print',
          exportTicket: ticket.exportTicket,
          subscriptionTier: subscriptionTierPdf,
        });
        await markPendingPrintPaymentStashed(ticket.exportTicket);

        printStashReadyRef.current = { fingerprint: printFormFingerprint(), ...ticket };
        printStashErrorRef.current = null;
        return ticket;
      })();

      printStashInFlightRef.current = { exportTicket: ticket.exportTicket, promise: run };
      trackPrintStashPromise(run);
      try {
        return await run;
      } catch (e) {
        printStashErrorRef.current = { exportTicket: ticket.exportTicket, error: e };
        throw e;
      } finally {
        if (printStashInFlightRef.current?.promise === run) {
          printStashInFlightRef.current = null;
        }
      }
    },
    [printFormFingerprint, subscriptionDb],
  );

  /** Prefetch fond : ticket + stash dès que l’adresse est prête. */
  const ensurePrintStashed = useCallback(async (): Promise<PrintTicketInfo> => {
    const ticket = await ensurePrintTicket();
    return await runPrintStash(ticket);
  }, [ensurePrintTicket, runPrintStash]);

  /**
   * Après paid : confirmation **tout de suite** (Low Friction).
   * Stash + kick 202 = fond (filet aussi sur l’écran confirmation). Ne bloque plus
   * l’UI sur upload photos / PREP_NOT_READY — c’était le « Presque fini… » interminable.
   */
  const completePrintAfterPaid = useCallback(
    async (opts: {
      exportTicket: string;
      emailNorm: string;
      priceCents: number;
      /** Reprise AppState : pas d’Alert spam ; le tap Commander reste verbeux. */
      quiet?: boolean;
    }) => {
      if (printFulfillInFlight || fulfillLockRef.current) return;
      printFulfillInFlight = true;
      fulfillLockRef.current = true;
      try {
        const pendingPayload = await getPendingBookOrderPdfPayload();
        const exportRequestId =
          peekExportTicketClaims(opts.exportTicket)?.export_request_id?.trim() ||
          (await getPendingPrintPayment())?.exportRequestId?.trim() ||
          '';

        printBreadcrumb('print.complete_after_paid.start', {
          exportRequestId,
          hasPayload: !!pendingPayload,
          bookId,
          quiet: opts.quiet === true,
        });

        await setLastGuestExportEmail(opts.emailNorm);

        // Cache local confort pour la prochaine commande (paint instantané).
        const live = liveFormRef.current;
        void setLastPrintOrderForm({
          email: opts.emailNorm,
          fullName: live.fullName,
          shippingName: live.shippingName,
          line1: live.line1,
          line2: live.line2,
          city: live.city,
          zip: live.zip,
          country,
        });

        if (exportRequestId) {
          await rememberLocalPrintOrder({
            id: exportRequestId,
            createdAt: new Date().toISOString(),
            priceCents: opts.priceCents,
            status: 'printing',
            shippingName: live.shippingName.trim(),
            bookId: pendingPayload?.bookId || bookId,
            childId: pendingPayload?.childId || childId,
            bookTitle: (pendingPayload?.coverTitle || book?.title || '').trim(),
          });
        }

        // Quitter l’overlay immédiatement — pending conservé pour le filet stash/kick.
        submittingRef.current = false;
        setSubmitting(false);
        setPrintPhase('idle');
        navigateToConfirmation({
          pricePaidEuros: opts.priceCents / 100,
          emailNorm: opts.emailNorm,
        });

        const finishResult = await finishPrintStashAndKickIfNeeded();
        printBreadcrumb('print.complete_after_paid.result', {
          exportRequestId,
          result: finishResult,
        });

        if (finishResult === 'missing_payload') {
          printCaptureMessage(
            'print.complete_after_paid',
            'paid without local payload — clearing pending; server/ops handle fulfill',
            'error',
            { exportRequestId, bookId },
          );
          if (exportRequestId) {
            await rememberLocalPrintOrder({
              id: exportRequestId,
              createdAt: new Date().toISOString(),
              priceCents: opts.priceCents,
              status: 'failed',
              shippingName: '',
              bookId,
              childId,
              bookTitle: (pendingPayload?.coverTitle || book?.title || '').trim(),
            });
          }
          await clearPendingPrintPayment();
        } else if (finishResult === 'error') {
          // Pending laissé pour reprise confirmation / AppState ; retries serveur.
          printCaptureMessage(
            'print.complete_after_paid',
            'stash/kick filet failed after paid — server retries own',
            'warning',
            { exportRequestId, bookId },
          );
        }

        printTicketRef.current = null;
        printStashReadyRef.current = null;
      } catch (e) {
        printCaptureError('print.complete_after_paid', e, { bookId });
        throw e;
      } finally {
        fulfillLockRef.current = false;
        printFulfillInFlight = false;
        submittingRef.current = false;
        setSubmitting(false);
        setPrintPhase('idle');
      }
    },
    [book?.title, bookId, childId, country, navigateToConfirmation],
  );

  const applyPrintSubmitError = useCallback(
    (e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e ?? 'book_order_submit_failed'));
      if (isSentryEnabled()) {
        Sentry.captureException(err, {
          tags: { 'app.errorScope': 'bookOrder.submit' },
          extra: { message: err.message.slice(0, 240) },
        });
      }
      if (e instanceof Error && (e.message === 'PREP_NOT_READY' || e.message.startsWith('PREP_NOT_READY:'))) {
        setFieldErrors({ submit: 'Préparation des médias en cours. Attends quelques secondes puis réessaie.' });
      } else if (isDeviceStorageFullError(e)) {
        setFieldErrors({ submit: t('bookOrder.storageFull') });
      } else if (e instanceof Error && e.message === 'STRIPE_UNCONFIGURED') {
        setFieldErrors({ submit: t('bookOrder.payUnconfigured') });
      } else if (e instanceof Error && e.message === 'SHIPPING_INVALID') {
        setFieldErrors({ submit: t('bookOrder.shippingInvalid') });
      } else if (e instanceof Error && e.message === 'PRINT_STASH_OR_FULFILL_FAILED') {
        setFieldErrors({ submit: t('bookOrder.printFulfillFailed') });
      } else if (e instanceof Error && e.message === 'EXPORT_PAYMENT_REQUIRED') {
        setFieldErrors({ submit: t('bookOrder.payNotConfirmed') });
      } else if (e instanceof Error && /Invalid export ticket/i.test(e.message)) {
        setFieldErrors({ submit: t('bookOrder.payTicketExpired') });
      } else if (
        e instanceof Error &&
        (/SIGNED_UPLOAD_FAILED|STORAGE_TRANSIENT|STORAGE_SERVER_ERROR|RATE_LIMITED|PRINT_PAYLOAD_LOCAL|ALBUM_SLOT/i.test(
          e.message,
        ) ||
          /Envoi des photos incomplet|connexion instable|toutes les photos/i.test(e.message))
      ) {
        setFieldErrors({ submit: t('bookOrder.printUploadTransient') });
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
      } else if (
        e instanceof Error &&
        (/EXPO_PUBLIC_PDF_SERVER_URL|Service PDF non configuré|n’est disponible que via le service/i.test(
          e.message,
        ))
      ) {
        setFieldErrors({
          submit:
            'Le service de préparation du livre est indisponible pour le moment. Réessaie dans un instant.',
        });
      } else if (e instanceof Error && /<\s*!?\s*doctype|<\s*html/i.test(e.message)) {
        setFieldErrors({ submit: t('bookOrder.printUploadTransient') });
      } else {
        const msg = e instanceof Error ? e.message : 'Échec de la commande.';
        setFieldErrors({
          submit: msg.length > 220 || /<\s*html/i.test(msg) ? t('bookOrder.printUploadTransient') : msg,
        });
      }
    },
    [t],
  );

  const handlePrintAfterPaidError = useCallback(
    (e: unknown) => {
      submittingRef.current = false;
      setSubmitting(false);
      setPrintPhase('idle');
      applyPrintSubmitError(e);
    },
    [applyPrintSubmitError],
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

    // Vérité clavier : ce qui part au serveur (et à Gelato) = exactement ce qui est à l’écran.
    const live = readLiveForm();
    const mail = live.email;
    const nowIso = new Date().toISOString();
    // Contact CRM : prénom/nom connu (préremplissage) sinon nom sur le colis.
    const contactFullName = live.fullName || live.shippingName || null;
    const finalShipping = {
      shippingName: live.shippingName,
      fullName: contactFullName,
      address: {
        line1: live.line1,
        ...(live.line2 ? { line2: live.line2 } : {}),
        city: live.city,
        zip: live.zip,
        country,
      },
    };

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
      // Overlay cœur dès le tap (≈2 s : ticket + session Stripe), puis Checkout **tout de suite**.
      // L’upload des photos tourne en fond pendant le paiement.
      Keyboard.dismiss();
      setSubmitting(true);
      submittingRef.current = true;
      setPrintPhase('opening');
      try {
        if (!pendingPayload) {
          setFieldErrors({ submit: 'Aucun aperçu de livre chargé. Repasse par l’aperçu du livre.' });
          return;
        }

        const existingPay = await getPendingPrintPayment();
        if (
          existingPay &&
          existingPay.bookId === bookId &&
          !isExportTicketExpired(existingPay.exportTicket)
        ) {
          try {
            const stPaid = await fetchPrintPaymentStatus(existingPay.exportTicket);
            if (stPaid === 'paid') {
              await completePrintAfterPaid({
                exportTicket: existingPay.exportTicket,
                emailNorm: mail,
                priceCents: existingPay.priceCents,
              });
              return;
            }
          } catch {
            await clearPendingPrintPayment();
            printStashReadyRef.current = null;
            printTicketRef.current = null;
          }
        }

        const ticket = await ensurePrintTicket();
        const { exportTicket, priceCents } = ticket;

        // Checkout **tout de suite** : l’upload continue en fond (prefetch + cette promesse).
        // On n’attend le stash qu’après `paid` (completePrintAfterPaid joint la même promesse).
        // Bloquer ici = overlay « Ton livre prend vie » interminable avant Stripe.
        setPrintPhase('opening');
        void runPrintStash(ticket).catch(() => {
          /* surface après paid */
        });

        const returnUrl = ExpoLinking.createURL('book-order-return');
        // Adresse **finale** figée ici (le ticket a pu être créé en fond pendant la saisie).
        const pay = await createPrintPayment({
          exportTicket,
          returnUrl,
          customerEmail: mail,
          shipping: finalShipping,
        });
        if (pay.paymentStatus === 'paid') {
          try {
            await completePrintAfterPaid({ exportTicket, emailNorm: mail, priceCents });
          } catch (e) {
            handlePrintAfterPaidError(e);
          }
          return;
        }
        if (!pay.checkoutUrl) {
          throw new Error(t('bookOrder.payOpenFailed'));
        }

        // Checkout : l’overlay (View, pas Modal) reste affiché sous SFSafariViewController —
        // pas de flash du formulaire, et aucune présentation iOS en conflit.
        const checkoutUrl = pay.checkoutUrl;
        const hideWait = () => {
          submittingRef.current = false;
          setSubmitting(false);
          setPrintPhase('idle');
        };

        let st: 'unpaid' | 'paid' | 'failed' | 'refunded' = 'unpaid';
        try {
          st = await openPrintCheckoutAndWaitPaid({
            checkoutUrl,
            exportTicket,
            onBrowserClosed: ({ canceled }) => {
              if (canceled) {
                hideWait();
                return;
              }
              setSubmitting(true);
              submittingRef.current = true;
              setPrintPhase('checking');
            },
          });
        } catch (e) {
          hideWait();
          if (e instanceof Error && e.message === 'PRINT_CHECKOUT_OPEN_FAILED') {
            Alert.alert(t('bookOrder.payCheckoutTitle'), t('bookOrder.payOpenFailed'), [
              { text: t('cancel'), style: 'cancel' },
              {
                text: t('bookOrder.payCheckoutReopen'),
                onPress: () => {
                  void Linking.openURL(checkoutUrl);
                },
              },
            ]);
            return;
          }
          throw e;
        }
        if (st !== 'paid') {
          hideWait();
          Alert.alert(t('bookOrder.payCheckoutTitle'), t('bookOrder.payCheckoutNotDone'), [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('bookOrder.payCheckoutReopen'),
              onPress: () => {
                void Linking.openURL(checkoutUrl);
              },
            },
          ]);
          setFieldErrors({ submit: t('bookOrder.payNotConfirmed') });
          return;
        }
        try {
          await completePrintAfterPaid({ exportTicket, emailNorm: mail, priceCents });
        } catch (e) {
          handlePrintAfterPaidError(e);
        }
      } catch (e) {
        applyPrintSubmitError(e);
      } finally {
        // Si la finalisation tourne déjà via la reprise (deep link / AppState), garder l’overlay.
        if (!fulfillLockRef.current) {
          submittingRef.current = false;
          setSubmitting(false);
          setPrintPhase('idle');
        }
      }
      return;
    }

    // PDF
    Keyboard.dismiss();
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
      applyPrintSubmitError(e);
    } finally {
      setSubmitting(false);
    }
  }, [
    applyPrintSubmitError,
    bookId,
    child,
    childId,
    contentVerified,
    country,
    exportMode,
    getFieldErrors,
    handlePrintAfterPaidError,
    memoryPageCount,
    navigateToConfirmation,
    navigateToFinalizeMedia,
    completePrintAfterPaid,
    ensurePrintTicket,
    runPrintStash,
    readLiveForm,
    router,
    subscriptionDb,
    t,
  ]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  // Code postal FR → communes (fond, cache) : préremplit la ville si vide et unique ; sinon
  // alimente un hint doux sous le champ ville. Jamais bloquant, jamais d’attente visible.
  useEffect(() => {
    if (exportMode !== 'print' || country !== 'FR') {
      setZipCommunes(null);
      return;
    }
    const z = zip.trim();
    if (!isFrenchPostalCode(z)) {
      setZipCommunes(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void getFrenchCommunesForPostalCode(z).then(names => {
        if (cancelled) return;
        setZipCommunes({ zip: z, names });
        const unique = uniqueCommuneForAutofill(names);
        if (unique && !liveFormRef.current.city.trim()) {
          applyField('city', unique);
          clearError('city');
        }
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [applyField, clearError, country, exportMode, zip]);

  const cityHint = useMemo(() => {
    if (!zipCommunes || zipCommunes.zip !== zip.trim()) return null;
    return getCityHint(city, zipCommunes.names);
  }, [city, zip, zipCommunes]);

  // Invalide ticket / stash seulement si livre / e-mail / remise change (plus l’adresse).
  // Ne jamais clear un pending **paid** (sinon on perd la reprise Gelato).
  useEffect(() => {
    const fp = printFormFingerprint();
    const ticket = printTicketRef.current;
    if (ticket && ticket.fingerprint !== fp) {
      printTicketRef.current = null;
      printStashReadyRef.current = null;
      printStashErrorRef.current = null;
      if (!printStashInFlightRef.current && !printTicketInFlightRef.current) {
        void (async () => {
          const pending = await getPendingPrintPayment();
          if (!pending) return;
          try {
            const st = await fetchPrintPaymentStatus(pending.exportTicket);
            if (st === 'paid') {
              printBreadcrumb('print.ticket.keep_paid_pending', {
                exportRequestId: pending.exportRequestId,
              });
              return;
            }
          } catch {
            /* si status illisible, ne pas wipe un pending récent */
            return;
          }
          await clearPendingPrintPayment();
        })();
      }
    }
  }, [printFormFingerprint]);

  // Low Friction : ticket + stash dès que l’adresse est prête (pendant que tu coches la case légale).
  // L’empreinte ignore l’adresse : une fois le prefetch lancé, taper la ville ne le relance pas.
  useEffect(() => {
    if (exportMode !== 'print' || !printAddressReady || loading || submitting) return;
    const fp = printFormFingerprint();
    if (
      printStashReadyRef.current?.fingerprint === fp &&
      printStashReadyRef.current &&
      !isExportTicketExpired(printStashReadyRef.current.exportTicket)
    ) {
      return;
    }
    if (
      printStashInFlightRef.current &&
      printTicketRef.current?.fingerprint === fp
    ) {
      return;
    }
    const timer = setTimeout(() => {
      void (async () => {
        // Pending paid → finaliser Gelato, ne pas créer un nouveau ticket en prefetch.
        const pending = await getPendingPrintPayment();
        if (pending && pending.bookId === bookId && !isExportTicketExpired(pending.exportTicket)) {
          try {
            const st = await fetchPrintPaymentStatus(pending.exportTicket);
            if (st === 'paid') {
              printBreadcrumb('print.prefetch.paid_finish', {
                exportRequestId: pending.exportRequestId,
              });
              // Ne pas laisser le formulaire « mort » : finaliser Gelato (re-stash si failed).
              void completePrintAfterPaid({
                exportTicket: pending.exportTicket,
                emailNorm: pending.email,
                priceCents: pending.priceCents,
                quiet: true,
              });
              return;
            }
          } catch {
            /* continue prefetch unpaid */
          }
        }
        try {
          await ensurePrintStashed();
        } catch (e) {
          if (e instanceof Error && e.message === 'PRINT_ALREADY_PAID') return;
          if (__DEV__) console.warn('[book-order] prefetch stash', e);
        }
      })();
    }, 400);
    return () => clearTimeout(timer);
  }, [
    bookId,
    completePrintAfterPaid,
    ensurePrintStashed,
    exportMode,
    printAddressReady,
    loading,
    printFormFingerprint,
    submitting,
  ]);

  useEffect(() => {
    if (exportMode !== 'print' || !bookId) return;

    const tryResumePaid = async (waitForPaid: boolean) => {
      // Si un kick est déjà en cours (souvent gelé après background iOS), on le laisse
      // finir — `finishPrint` re-stashera si le serveur est en failed.
      if (printFulfillInFlight || fulfillLockRef.current) return;
      const pending = await getPendingPrintPayment();
      if (!pending || pending.bookId !== bookId) return;
      if (isExportTicketExpired(pending.exportTicket)) return;
      try {
        if (waitForPaid) {
          setSubmitting(true);
          submittingRef.current = true;
          setPrintPhase('checking');
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
        }
        // Confirm-on-paid : pas d’overlay « Presque fini… » (stash en fond).
        await completePrintAfterPaid({
          exportTicket: pending.exportTicket,
          emailNorm: pending.email,
          priceCents: pending.priceCents,
          quiet: !waitForPaid,
        });
      } catch (e) {
        handlePrintAfterPaidError(e);
        submittingRef.current = false;
        setSubmitting(false);
        setPrintPhase('idle');
      }
    };

    // Mount : reprise paid même sans deep link (évite formulaire bloqué sans AppState).
    void tryResumePaid(!!resumePayment);

    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void tryResumePaid(false);
    });
    return () => sub.remove();
  }, [bookId, exportMode, completePrintAfterPaid, handlePrintAfterPaidError, resumePayment]);

  /**
   * E-mail suspect / différent du compte — rappel doux, jamais bloquant (Low Friction).
   * Doit rester **avant** les `return` anticipés (spinner) : un hook après un early return
   * casse l’ordre des hooks (« Rendered more hooks… ») → crash fatal en prod.
   */
  const emailHint = useMemo(() => getEmailHint(email, peekRealAuthEmail()), [email]);

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
    const loadingBody =
      waitMsgStep <= 0
        ? t('bookOrder.formLoadingBody1')
        : waitMsgStep === 1
          ? t('bookOrder.formLoadingBody2')
          : t('bookOrder.formLoadingBody3');
    return (
      <View style={[styles.center, { paddingTop: insets.top, paddingHorizontal: scale(28) }]}>
        <ActivityIndicator size="large" color={THEME.brandCtaOrange} />
        <Text
          style={[
            styles.muted,
            { marginTop: scale(20), textAlign: 'center' },
            dm500 && { fontFamily: dm500 },
          ]}
        >
          {t('bookOrder.formLoadingTitle')}
        </Text>
        <Text
          style={[
            styles.muted,
            { marginTop: scale(8), textAlign: 'center' },
            dm500 && { fontFamily: dm500 },
          ]}
        >
          {loadingBody}
        </Text>
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

  const emailHintNode = emailHint ? (
    <View style={styles.emailHintRow}>
      <Text style={[styles.emailHint, dm500 && { fontFamily: dm500 }]}>
        {emailHint.kind === 'typo'
          ? t('bookOrder.emailHintTypo', { suggestion: emailHint.suggestion })
          : emailHint.kind === 'short'
            ? t('bookOrder.emailHintShort')
            : t('bookOrder.emailHintAccount', { accountEmail: emailHint.accountEmail })}
      </Text>
      {emailHint.kind !== 'short' ? (
        <Pressable
          hitSlop={8}
          onPress={() => {
            applyField('email', emailHint.kind === 'typo' ? emailHint.suggestion : emailHint.accountEmail);
            setEmailEditing(false);
            clearError('email');
          }}
        >
          <Text style={[styles.emailHintAction, dm600 && { fontFamily: dm600 }]}>
            {emailHint.kind === 'typo'
              ? t('bookOrder.emailHintUse')
              : t('bookOrder.emailHintUseAccount')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  ) : null;

  /** Ville ≠ communes du code postal — suggestion douce, saisie libre conservée. */
  const cityHintNode = cityHint ? (
    <View style={styles.emailHintRow}>
      <Text style={[styles.emailHint, dm500 && { fontFamily: dm500 }]}>
        {t('bookOrder.cityHint', { zip: zip.trim(), suggestion: cityHint.suggestion })}
      </Text>
      <Pressable
        hitSlop={8}
        onPress={() => {
          applyField('city', cityHint.suggestion);
          clearError('city');
        }}
      >
        <Text style={[styles.emailHintAction, dm600 && { fontFamily: dm600 }]}>
          {t('bookOrder.cityHintUse')}
        </Text>
      </Pressable>
    </View>
  ) : null;

  const printWaitVisible = exportMode === 'print' && submitting;
  const printWaitTitle =
    printPhase === 'opening' || printPhase === 'checking'
      ? t('bookOrder.printOpeningTitle')
      : t('bookOrder.printWaitTitle');
  const printWaitSubtitle =
    printPhase === 'opening'
      ? t('bookOrder.printOpeningBody')
      : printPhase === 'checking'
        ? t('bookOrder.printCheckingBody')
        : printPhase === 'finishing'
          ? waitMsgStep <= 0
            ? t('bookOrder.printFinishingBody1')
            : waitMsgStep === 1
              ? t('bookOrder.printFinishingBody2')
              : t('bookOrder.printFinishingBody3')
          : t('bookOrder.printWaitStagingBody');

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
        {/* Print : attente = overlay cœur (pas de spinner dans le CTA). PDF : spinner OK. */}
        {submitting && exportMode === 'pdf' ? (
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
            <Text style={styles.plusPromo}>
              {t('bookOrder.plusPromo', {
                price: formatAppCurrency(printQuote.premiumUpsell.totalEuros, lang),
                savings: formatAppCurrency(printQuote.premiumUpsell.savingsEuros, lang),
              })}
            </Text>
            <Text style={styles.plusLink}>{t('bookOrder.discoverPlus')}</Text>
          </Pressable>
        ) : null}

        {exportMode === 'print' && __DEV__ ? (
          <Pressable
            style={styles.devFillBtn}
            onPress={() => {
              const stamp = Date.now().toString(36);
              applyField('email', `qa+gelato-${stamp}@example.com`);
              setEmailEditing(false);
              applyField('shippingName', 'Test Petit Cœur Gelato');
              applyField('line1', '12 rue Example');
              applyField('line2', '');
              applyField('city', 'Paris');
              applyField('zip', '75001');
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
                <Text style={styles.fieldLabel}>
                  {t('bookOrder.fieldFullName')}
                </Text>
                <StableTextInput
                  style={[
                    styles.fieldInput,
                    dm500 && { fontFamily: dm500 },
                    fieldErrors.shippingName && styles.inputError,
                  ]}
                  value={shippingName}
                  onChangeTextImmediate={v => {
                    liveFormRef.current.shippingName = v;
                  }}
                  onChangeText={v => {
                    applyField('shippingName', v);
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
                <Text style={styles.fieldLabel}>
                  {t('bookOrder.fieldAddress')}
                </Text>
                <StableTextInput
                  style={[
                    styles.fieldInput,
                    dm500 && { fontFamily: dm500 },
                    fieldErrors.line1 && styles.inputError,
                  ]}
                  value={line1}
                  onChangeTextImmediate={v => {
                    liveFormRef.current.line1 = v;
                  }}
                  onChangeText={v => {
                    applyField('line1', v);
                    clearError('line1');
                  }}
                  placeholder={t('bookOrder.placeholderAddress')}
                  placeholderTextColor={THEME.textSecondary}
                />
              </View>
              {fieldErrors.line1 ? <Text style={styles.err}>{fieldErrors.line1}</Text> : null}

              <View style={styles.fieldDivider} />
              <View style={styles.fieldBlock}>
                <Text style={styles.fieldLabel}>
                  {t('bookOrder.fieldAddress2')}
                </Text>
                <StableTextInput
                  style={[styles.fieldInput, dm500 && { fontFamily: dm500 }]}
                  value={line2}
                  onChangeTextImmediate={v => {
                    liveFormRef.current.line2 = v;
                  }}
                  onChangeText={v => applyField('line2', v)}
                  placeholder={t('bookOrder.placeholderAddress2')}
                  placeholderTextColor={THEME.textSecondary}
                />
              </View>

              <View style={styles.fieldDivider} />
              <View style={styles.row2}>
                <View style={[styles.grow, styles.fieldBlock]}>
                  <Text style={styles.fieldLabel}>
                    {t('bookOrder.fieldZip')}
                  </Text>
                  <StableTextInput
                    style={[
                      styles.fieldInput,
                      dm500 && { fontFamily: dm500 },
                      fieldErrors.zip && styles.inputError,
                    ]}
                    value={zip}
                    onChangeTextImmediate={v => {
                      liveFormRef.current.zip = v;
                    }}
                    onChangeText={v => {
                      applyField('zip', v);
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
                  <Text style={styles.fieldLabel}>
                    {t('bookOrder.fieldCity')}
                  </Text>
                  <StableTextInput
                    style={[
                      styles.fieldInput,
                      dm500 && { fontFamily: dm500 },
                      fieldErrors.city && styles.inputError,
                    ]}
                    value={city}
                    onChangeTextImmediate={v => {
                      liveFormRef.current.city = v;
                    }}
                    onChangeText={v => {
                      applyField('city', v);
                      clearError('city');
                    }}
                    placeholder={t('bookOrder.fieldCity')}
                    placeholderTextColor={THEME.textSecondary}
                  />
                  {fieldErrors.city ? <Text style={styles.err}>{fieldErrors.city}</Text> : null}
                  {cityHintNode}
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
                  <Text style={styles.fieldLabel}>
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
                <Text style={styles.fieldLabel}>
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
                <StableTextInput
                  style={[
                    styles.fieldInput,
                    dm500 && { fontFamily: dm500 },
                    fieldErrors.email && styles.inputError,
                  ]}
                  value={email}
                  onChangeTextImmediate={v => {
                    liveFormRef.current.email = v;
                  }}
                  onChangeText={v => {
                    applyField('email', v);
                    clearError('email');
                  }}
                  onEndEditing={e => {
                    // Texte natif (l’état parent peut avoir 1 frappe de retard).
                    if (isValidEmail(e.nativeEvent.text)) setEmailEditing(false);
                  }}
                  placeholder="email@exemple.com"
                  placeholderTextColor={THEME.textSecondary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus={emailEditing}
                />
              )}
              {fieldErrors.email ? <Text style={styles.err}>{fieldErrors.email}</Text> : null}
              {emailHintNode}
            </View>
          </>
        ) : (
          <>
            <Text style={[styles.section, dm600 && { fontFamily: dm600 }]}>
              {t('bookOrder.fieldEmail')}
            </Text>
            <View style={styles.formCard}>
              <StableTextInput
                style={[
                  styles.fieldInput,
                  dm500 && { fontFamily: dm500 },
                  fieldErrors.email && styles.inputError,
                ]}
                value={email}
                onChangeTextImmediate={v => {
                  liveFormRef.current.email = v;
                }}
                onChangeText={v => {
                  applyField('email', v);
                  clearError('email');
                }}
                placeholder="email@exemple.com"
                placeholderTextColor={THEME.textSecondary}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              {fieldErrors.email ? <Text style={styles.err}>{fieldErrors.email}</Text> : null}
              {emailHintNode}
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
        visible={printWaitVisible || (submitting && exportMode === 'pdf')}
        title={printWaitVisible ? printWaitTitle : undefined}
        subtitle={printWaitVisible ? printWaitSubtitle : undefined}
        note={
          printWaitVisible && printPhase !== 'finishing'
            ? t('bookOrder.printWaitKeepOpen')
            : undefined
        }
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
  plusPromo: {
    fontSize: scale(15),
    fontWeight: '400',
    lineHeight: scale(21),
    color: THEME.textPrimary,
    marginBottom: scale(6),
  },
  plusLink: {
    fontSize: scale(16),
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
    fontSize: scale(15),
    fontWeight: '500',
    color: THEME.textMuted,
    marginBottom: scale(5),
  },
  fieldInput: {
    fontSize: scale(17),
    color: THEME.textPrimary,
    paddingVertical: Platform.OS === 'ios' ? scale(2) : 0,
    margin: 0,
  },
  fieldValue: {
    fontSize: scale(17),
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
  emailHintRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: scale(8),
    marginTop: scale(6),
  },
  emailHint: {
    fontSize: scale(13),
    lineHeight: scale(18),
    color: THEME.textSecondary,
    flexShrink: 1,
  },
  emailHintAction: {
    fontSize: scale(13),
    lineHeight: scale(18),
    fontWeight: '600',
    color: THEME.brandCtaOrange,
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
