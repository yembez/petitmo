import { useCallback, useMemo, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from 'react-native'
import { Image } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useFocusEffect } from '@react-navigation/native'
import { StatusBar, setStatusBarStyle } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  useFonts as useDmSansFonts,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans'
import { BookOpen, ChevronRight, Cloud, Lock, X } from 'lucide-react-native'
import PetitmoLogoManuscrit, { PETITMO_LOGO_VIEWBOX } from '@/components/PetitmoLogoManuscrit'
import { upgradeToFullCloud } from '@/services/migration'
import { flushPendingCloudUploadsOnce } from '@/services/pendingCloudFlush'
import { hydrateTabScreensFromLocal } from '@/services/tabScreensHydrate'
import { getChildren } from '@/services/children'
import { listLocalChildrenForUser } from '@/lib/localDb'
import { peekLastRealAuthUserId } from '@/services/accountLocalReset'
import { grantDigitalExportPurchase } from '@/lib/digitalExportPurchase'
import { FREE_TIER_LIMIT, FREE_TIER_VIDEO_LIMIT, PAID_TIER_VIDEO_MAX_DURATION, PAID_TIER_VOICE_MAX_DURATION } from '@/lib/limits'
import { THEME } from '@/constants/theme'
import { hp, scale, screenHeight, screenWidth, verticalScale } from '@/utils/responsive'

export type PaywallContext =
  /** Ouverture volontaire (onboarding, découvert…) — hero neutre, sans mention du quota souvenirs. */
  | 'GENERAL'
  | 'LIMIT_REACHED'
  | 'VIDEO_LIMIT_REACHED'
  | 'VOICE_LIMIT_REACHED'
  | 'EXPORT_PAYWALL'
  /** Export PDF serveur — achat à l’acte 4,99 € (spec). */
  | 'EXPORT_DIGITAL_PDF'
  | 'BOOK_ORDER'
  | 'DAY_30'
  | 'DAY_60'
  | 'DAY_90'

type PaywallParams = {
  context?: PaywallContext
  childName?: string
  /** Où renvoyer l’utilisatrice à la fermeture (ex. quota atteint pendant import → fil). */
  returnTo?: string
  /** Depuis onboarding « S’abonner » : après paywall → profil enfant si besoin. */
  from?: string
}

function normalizePaywallReturnTo(raw: unknown): 'fil' | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  return key === 'fil' ? 'fil' : null
}

function isSubscribeOnboarding(raw: unknown): boolean {
  const v = Array.isArray(raw) ? raw[0] : raw
  return typeof v === 'string' && v.trim() === 'subscribe'
}

/** Hero souscription hors quota souvenirs : pas de « X premiers souvenirs » (cf. AGENTS.md). */
const PAYWALL_NEUTRAL_HEADLINE = 'Les abonnements pour préserver chaque moment'

const VALID_PAYWALL_CONTEXTS = [
  'GENERAL',
  'LIMIT_REACHED',
  'VIDEO_LIMIT_REACHED',
  'VOICE_LIMIT_REACHED',
  'EXPORT_PAYWALL',
  'EXPORT_DIGITAL_PDF',
  'BOOK_ORDER',
  'DAY_30',
  'DAY_60',
  'DAY_90',
] as const satisfies readonly PaywallContext[]

function normalizePaywallContext(raw: unknown): PaywallContext {
  if (typeof raw !== 'string' || !raw.trim()) return 'GENERAL'
  const key = raw.trim()
  if (key === 'BOOK_ORDER_DISCOUNT') return 'BOOK_ORDER'
  /** Vidéo dans un livre (gratuit) → même hero neutre que l’onboarding. */
  if (key === 'BOOK_VIDEO') return 'GENERAL'
  if ((VALID_PAYWALL_CONTEXTS as readonly string[]).includes(key)) {
    return key as PaywallContext
  }
  return 'GENERAL'
}

const PAYWALL_MESSAGES: Record<
  PaywallContext,
  {
    eyebrow: string
    title: (childName: string) => string
    subtitle: string
  }
> = {
  GENERAL: {
    eyebrow: 'Petitmo+',
    title: () => PAYWALL_NEUTRAL_HEADLINE,
    subtitle: '',
  },
  LIMIT_REACHED: {
    eyebrow: 'Petitmo+',
    title: n => `Tu as atteint tes ${FREE_TIER_LIMIT} souvenirs de ${n}.`,
    subtitle: 'Continue à capturer chaque moment sans limite.',
  },
  VIDEO_LIMIT_REACHED: {
    eyebrow: 'Petitmo+',
    title: n => `Tu as utilisé tes ${FREE_TIER_VIDEO_LIMIT} vidéos gratuites de ${n}.`,
    subtitle: `Des vidéos illimitées en nombre, jusqu’à ${Math.round(PAID_TIER_VIDEO_MAX_DURATION / 60)} min chacune avec Petitmo+.`,
  },
  VOICE_LIMIT_REACHED: {
    eyebrow: 'Petitmo+',
    title: n => `2 minutes, c'est déjà une belle histoire de ${n}.`,
    subtitle: `Des vocaux illimités en nombre, jusqu’à ${Math.round(PAID_TIER_VOICE_MAX_DURATION / 60)} min avec Petitmo+.`,
  },
  EXPORT_PAYWALL: {
    eyebrow: 'Petitmo+',
    title: n => `Exporte tous les souvenirs de ${n}.`,
    subtitle: 'Archive complète en ZIP, accessible à tout moment.',
  },
  EXPORT_DIGITAL_PDF: {
    eyebrow: 'Export PDF',
    title: n => `Livre PDF pour ${n}`,
    subtitle:
      'Paiement unique 4,99 € : génération haute qualité sur nos serveurs (mise en page stable, QR médias). Abonnement non requis.',
  },
  BOOK_ORDER: {
    eyebrow: 'Petitmo+',
    title: n => `Le livre de ${n} est prêt.`,
    subtitle: 'Abonne-toi : −10 % sur l’impression et QR audio/vidéo illimités.',
  },
  DAY_30: {
    eyebrow: 'Petitmo+',
    title: n => `Les souvenirs de ${n} méritent d'être protégés.`,
    subtitle: 'Sauvegarde illimitée dans le cloud, même si tu perds ton téléphone.',
  },
  DAY_60: {
    eyebrow: 'Petitmo+',
    title: n => `${n} grandit vite — ne perds aucun moment.`,
    subtitle: 'Souvenirs illimités, cloud sécurisé, livres −10 % et QR illimités.',
  },
  DAY_90: {
    eyebrow: 'Petitmo+',
    title: n => `Bientôt 3 mois de souvenirs de ${n}.`,
    subtitle: "Ils méritent d'être en sécurité pour toujours.",
  },
}

type Plan = 'yearly' | 'monthly'

const PAYWALL_BG = THEME.bg
/** Orange CTA charte plein — paywall (CTA, badges, sélection plan). */
const ACCENT = THEME.brandCtaOrange
const ACCENT_SOFT = THEME.tabBarActivePill
/** Cœur hero paywall uniquement — rosé charte. */
const PAYWALL_HEART = THEME.brandPrimary
const CARD = '#FFFFFF'
const MUTED = '#6B7280'
const LINE = 'rgba(0,0,0,0.08)'

const ANNUAL_FACTURE = 49.99
const MONTHLY = 5.99
const ANNUAL_PER_MONTH = (ANNUAL_FACTURE / 12).toFixed(2).replace('.', ',')
/** Spec §1 — export digital free. */
const DIGITAL_EXPORT_PDF_EUR = 4.99

function formatEuro(n: number) {
  return n.toFixed(2).replace('.', ',') + ' €'
}

export default function PaywallScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<PaywallParams>()
  const context: PaywallContext = normalizePaywallContext(params.context)
  const returnTo = normalizePaywallReturnTo(params.returnTo)
  const fromSubscribe = isSubscribeOnboarding(params.from)

  const continueAfterPaywall = useCallback(async () => {
    if (fromSubscribe) {
      const uid = peekLastRealAuthUserId()
      let count = uid ? listLocalChildrenForUser(uid).length : 0
      if (count === 0) {
        try {
          const children = await getChildren()
          count = children.length
        } catch (e) {
          console.warn('[paywall] getChildren after subscribe', e)
        }
      }
      if (count === 0) {
        router.replace({
          pathname: '/create-child',
          params: { intent: 'subscribe' },
        })
        return
      }
    }
    if (returnTo === 'fil') {
      router.replace('/(tabs)/fil')
      return
    }
    if (router.canGoBack()) {
      router.back()
      return
    }
    router.replace('/(tabs)')
  }, [fromSubscribe, returnTo, router])

  const dismissPaywall = () => {
    void continueAfterPaywall()
  }

  const [selectedPlan, setSelectedPlan] = useState<Plan>('monthly')
  const [isLoading, setIsLoading] = useState(false)

  const [dmLoaded] = useDmSansFonts({
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  })

  const msg = useMemo(() => PAYWALL_MESSAGES[context], [context])
  const childName =
    typeof params.childName === 'string' && params.childName.trim() ? params.childName : 'ton enfant'
  const isExportDigitalPdf = context === 'EXPORT_DIGITAL_PDF'

  const handlePurchase = async (plan: Plan) => {
    setIsLoading(true)
    try {
      await new Promise(r => setTimeout(r, 1200))
      const report = await upgradeToFullCloud()
      await flushPendingCloudUploadsOnce()
      await AsyncStorage.setItem('petitmo_subscribed_at', new Date().toISOString())
      await hydrateTabScreensFromLocal()
      // Sync-only : pas d’invalidate (fil / favoris ne flashent pas après abonnement).

      if (__DEV__) {
        const c = report.children
        const r = report.idRemap
        const lines = [
          `Session Supabase : ${report.hasUser ? 'oui' : 'NON'}`,
          report.userId ? `userId : ${report.userId.slice(0, 8)}…` : 'userId : —',
          r.childrenRemapped + r.memoriesRemapped > 0
            ? `IDs remappés : ${r.childrenRemapped} enfant(s), ${r.memoriesRemapped} souvenir(s)`
            : null,
          `Enfants : ${c.inserted} ajoutés / ${c.alreadyThere} déjà là / ${c.total} total`,
          `Souvenirs : ${report.memUploaded} montés / ${report.memSkipped} ignorés / ${report.memTotal} total`,
        ].filter((line): line is string => line != null)
        const allErrors = [...c.errors, ...report.memErrors]
        if (allErrors.length > 0) {
          lines.push('', 'Erreurs :', ...allErrors.slice(0, 6))
        }
        Alert.alert('Migration cloud (dev)', lines.join('\n'), [
          { text: 'OK', onPress: () => void continueAfterPaywall() },
        ])
        return
      }

      await continueAfterPaywall()
    } catch (e) {
      Alert.alert(
        'Erreur',
        __DEV__ && e instanceof Error ? e.message : "Impossible de finaliser l'achat.",
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleDigitalExportPdfPurchase = async () => {
    setIsLoading(true)
    try {
      await new Promise(r => setTimeout(r, 800))
      await grantDigitalExportPurchase()
      router.back()
    } catch {
      Alert.alert('Erreur', "Impossible de valider l'achat.")
    } finally {
      setIsLoading(false)
    }
  }

  const dm500 = dmLoaded ? 'DMSans_500Medium' : undefined
  const dm600 = dmLoaded ? 'DMSans_600SemiBold' : undefined
  const dm700 = dmLoaded ? 'DMSans_700Bold' : undefined

  const showMemoryLimitHero = context === 'LIMIT_REACHED'

  const contentBottomPad = Math.max(28, insets.bottom + 16)
  const contentPadH = { paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }
  const heroH = Math.min(Math.round(hp(32)), Math.round(screenHeight * 0.34))

  const paywallLogoW = scale(78)
  const paywallLogoH = paywallLogoW * (PETITMO_LOGO_VIEWBOX.height / PETITMO_LOGO_VIEWBOX.width)
  const logoPlusLayout = {
    position: 'absolute' as const,
    right: scale(-12),
    top: paywallLogoH * 0.17,
    fontSize: scale(23),
    lineHeight: scale(26),
  }

  /** Heure, batterie, signal… en blanc sur le hero sombre (comme Capturer / Favoris). */
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light')
      return () => setStatusBarStyle('dark')
    }, [])
  )

  return (
    <>
      <StatusBar style="light" />
      <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.rootContent, { paddingBottom: contentBottomPad }]}
      showsVerticalScrollIndicator={false}
      bounces
    >
      <View style={[styles.heroWrap, { height: heroH }]}>
        <Image
          source={require('@/assets/images/maman_enfant_paywall.png')}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
        />
        <LinearGradient
          colors={['rgba(0,0,0,0.62)', 'rgba(0,0,0,0.28)', 'transparent']}
          locations={[0, 0.55, 1]}
          style={styles.heroTopFade}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['rgba(250,250,247,0)', 'rgba(250,250,247,0.5)', PAYWALL_BG]}
          locations={[0.55, 0.88, 1]}
          style={styles.heroFade}
          pointerEvents="none"
        />
        <View
          style={[styles.heroLogoBlock, { top: insets.top + 8, left: 16 + insets.left }]}
          pointerEvents="none"
          accessibilityRole="image"
          accessibilityLabel="Petitmo+"
        >
          <View style={[styles.logoRow, { width: paywallLogoW, height: paywallLogoH }]}>
            <PetitmoLogoManuscrit
              width={paywallLogoW}
              height={paywallLogoH}
              color="#FFFFFF"
              shadow
            />
            <Text
              style={[styles.logoPlus, logoPlusLayout]}
              {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
            >
              +
            </Text>
          </View>
        </View>
        <Pressable
          onPress={dismissPaywall}
          style={({ pressed }) => [
            styles.closeFab,
            { top: insets.top + 10, right: 16 + insets.right },
            pressed && { opacity: 0.88 },
          ]}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Fermer"
        >
          <X size={18} color="#FFFFFF" strokeWidth={2.4} />
        </Pressable>
      </View>

      <View style={[styles.body, contentPadH]}>
        {isExportDigitalPdf ? (
          <>
            <Text style={[styles.headline, dm700 && { fontFamily: dm700 }]}>{msg.title(childName)}</Text>
            <Text style={[styles.subline, dm500 && { fontFamily: dm500 }]}>{msg.subtitle}</Text>
            <TouchableOpacity
              style={[
                styles.primaryCta,
                { marginTop: 24 },
                isLoading && { opacity: 0.75, justifyContent: 'center' },
              ]}
              activeOpacity={0.92}
              onPress={() => void handleDigitalExportPdfPurchase()}
              disabled={isLoading}
              accessibilityRole="button"
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.primaryCtaInner}>
                  <Text style={[styles.primaryCtaText, dm600 && { fontFamily: dm600 }]}>
                    Payer {formatEuro(DIGITAL_EXPORT_PDF_EUR)}
                  </Text>
                  <ChevronRight size={20} color="#FFFFFF" strokeWidth={2.5} />
                </View>
              )}
            </TouchableOpacity>
            <Pressable
              onPress={dismissPaywall}
              style={({ pressed }) => [styles.dismissCta, { marginTop: 16 }, pressed && { opacity: 0.78 }]}
              accessibilityRole="button"
            >
              <Text style={[styles.dismissCtaText, dm500 && { fontFamily: dm500 }]}>Pas maintenant</Text>
            </Pressable>
            <Text style={[styles.finePrint, dm500 && { fontFamily: dm500 }, { marginTop: 20 }]}>
              Paiement traité par l’App Store / Play Store une fois l’IAP branché. Pour l’instant, flux de démo
              local.
            </Text>
          </>
        ) : (
          <>
        {showMemoryLimitHero ? (
          <>
            <Text style={[styles.headline, dm700 && { fontFamily: dm700 }]}>
              Tu as capturé vos{'\n'}
              <Text style={styles.headlineCount}>{FREE_TIER_LIMIT}</Text> premiers souvenirs{' '}
              <Text style={styles.headlineHeart}>♥</Text>
            </Text>
            <Text style={[styles.subline, dm500 && { fontFamily: dm500 }]}>
              Continue à préserver chaque moment, {'\n'}sans limite.
            </Text>
          </>
        ) : (
          <>
            <View
              style={styles.headlineNeutralWrap}
              accessibilityRole="header"
              accessibilityLabel={PAYWALL_NEUTRAL_HEADLINE}
            >
              <Text
                style={[styles.headlineNeutralLine1, dm700 && { fontFamily: dm700 }]}
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.78}
                maxFontSizeMultiplier={1.35}
              >
                {PAYWALL_NEUTRAL_HEADLINE}
              </Text>
            </View>
            <View style={styles.neutralHeadlineSpacer} />
          </>
        )}

        <View style={styles.plansRow}>
          <Pressable
            onPress={() => setSelectedPlan('yearly')}
            style={({ pressed }) => [
              styles.planCard,
              selectedPlan === 'yearly' ? styles.planCardSelected : styles.planCardIdle,
              pressed && { opacity: 0.94 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedPlan === 'yearly' }}
          >
            <View style={styles.planSelectRow}>
              <View style={[styles.radioOuter, selectedPlan === 'yearly' && styles.radioOuterOn]}>
                {selectedPlan === 'yearly' ? <View style={styles.radioInner} /> : null}
              </View>
              <View style={styles.planPriceBlock}>
                <View style={styles.planNameRow}>
                  <Text style={[styles.planName, dm700 && { fontFamily: dm700 }]}>Annuel</Text>
                  <View style={styles.planDiscountPill}>
                    <Text style={[styles.planDiscountPillText, dm600 && { fontFamily: dm600 }]}>
                      -30%
                    </Text>
                  </View>
                </View>
                <Text
                  style={[
                    styles.planPriceMain,
                    styles.planPriceMainYear,
                    dm700 && { fontFamily: dm700 },
                  ]}
                >
                  {formatEuro(ANNUAL_FACTURE)}
                  <Text style={styles.planPerMoInline}>/an</Text>
                </Text>
                <Text style={[styles.planFine, dm500 && { fontFamily: dm500 }]}>
                  {ANNUAL_PER_MONTH} €/mois
                </Text>
              </View>
            </View>
          </Pressable>

          <Pressable
            onPress={() => setSelectedPlan('monthly')}
            style={({ pressed }) => [
              styles.planCard,
              selectedPlan === 'monthly' ? styles.planCardSelected : styles.planCardIdle,
              pressed && { opacity: 0.94 },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedPlan === 'monthly' }}
          >
            <View style={styles.planSelectRow}>
              <View style={[styles.radioOuter, selectedPlan === 'monthly' && styles.radioOuterOn]}>
                {selectedPlan === 'monthly' ? <View style={styles.radioInner} /> : null}
              </View>
              <View style={styles.planPriceBlock}>
                <Text style={[styles.planName, dm700 && { fontFamily: dm700 }]}>Mensuel</Text>
                <Text
                  style={[
                    styles.planPriceMain,
                    styles.planPriceMainMonth,
                    dm700 && { fontFamily: dm700 },
                  ]}
                >
                  {MONTHLY.toFixed(2).replace('.', ',')} €
                  <Text style={styles.planPerMoInline}>/mois</Text>
                </Text>
              </View>
            </View>
          </Pressable>
        </View>

        <View style={styles.benefitsCard}>
          <BenefitRow
            icon={<Text style={styles.benefitInfinityGlyph}>∞</Text>}
            title="Nombre de souvenirs illimités."
            desc="Textes, photos, vidéos jusqu'à 3mn, audios jusqu'à 5mn."
            dm600={dm600}
            dm500={dm500}
          />
          <View style={styles.benefitRule} />
          <BenefitRow
            icon={
              <View style={styles.cloudLock}>
                <Cloud size={13} color={ACCENT} strokeWidth={1.75} />
                <View style={styles.miniLock}>
                  <Lock size={6} color={ACCENT} strokeWidth={2} />
                </View>
              </View>
            }
            title="Sauvegardés en toute sécurité"
            desc="Retrouve tout, même en changeant de téléphone."
            dm600={dm600}
            dm500={dm500}
          />
          <View style={styles.benefitRule} />
          <BenefitRow
            icon={<BookOpen size={13} color={ACCENT} strokeWidth={1.75} />}
            title={'-10% sur les livres "vivants"'}
            desc="Avec les audios et vidéos inclus (via QR codes)"
            dm600={dm600}
            dm500={dm500}
          />
        </View>

        <TouchableOpacity
          style={[
            styles.primaryCta,
            isLoading && { opacity: 0.75 },
            isLoading && { justifyContent: 'center' },
          ]}
          activeOpacity={0.92}
          onPress={() => void handlePurchase(selectedPlan)}
          disabled={isLoading}
          accessibilityRole="button"
        >
          {isLoading ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <View style={styles.primaryCtaInner}>
              <Text style={[styles.primaryCtaText, dm600 && { fontFamily: dm600 }]}>
                S&apos;abonner
              </Text>
              <ChevronRight size={20} color="#FFFFFF" strokeWidth={2.5} />
            </View>
          )}
        </TouchableOpacity>

        <Pressable
          onPress={dismissPaywall}
          style={({ pressed }) => [styles.dismissCta, pressed && { opacity: 0.78 }]}
          accessibilityRole="button"
          accessibilityLabel="Pas maintenant"
        >
          <Text style={[styles.dismissCtaText, dm500 && { fontFamily: dm500 }]}>Pas maintenant</Text>
        </Pressable>

        <Text style={[styles.finePrint, dm500 && { fontFamily: dm500 }]}>
          Renouvellement automatique. Résiliable à tout moment{'\n'}dans les réglages de l&apos;App Store.
        </Text>
          </>
        )}
      </View>
    </ScrollView>
    </>
  )
}

function BenefitRow(props: {
  icon: React.ReactNode
  title: string
  desc?: string
  dm600?: string
  dm500?: string
}) {
  return (
    <View style={styles.benefitRow}>
      <View style={styles.benefitIconCircle}>{props.icon}</View>
      <View style={styles.benefitCopy}>
        <Text style={[styles.benefitTitle, props.dm600 && { fontFamily: props.dm600 }]}>{props.title}</Text>
        {props.desc ? (
          <Text style={[styles.benefitDesc, props.dm500 && { fontFamily: props.dm500 }]}>{props.desc}</Text>
        ) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: PAYWALL_BG,
  },
  rootContent: {
    flexGrow: 1,
  },
  heroWrap: {
    width: screenWidth,
    backgroundColor: '#E8E4DE',
    position: 'relative',
  },
  heroFade: {
    ...StyleSheet.absoluteFillObject,
  },
  heroLogoBlock: {
    position: 'absolute',
    zIndex: 3,
  },
  logoRow: {
    position: 'relative',
    overflow: 'visible',
  },
  heroTopFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '48%',
    zIndex: 1,
  },
  logoPlus: {
    color: '#FFFFFF',
    fontWeight: '800',
    letterSpacing: -1,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  closeFab: {
    position: 'absolute',
    zIndex: 4,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  body: {
    marginTop: -verticalScale(42),
    paddingTop: verticalScale(6),
    paddingBottom: 8,
  },
  headline: {
    textAlign: 'center',
    fontSize: scale(22),
    lineHeight: scale(28),
    letterSpacing: -0.35,
    color: '#1C1C1E',
    alignSelf: 'center',
    maxWidth: screenWidth - 40,
    textShadowColor: 'rgba(255,255,255,1)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 22,
  },
  /** Paywall « générique » : deux `Text` séparés + `adjustsFontSizeToFit` sur L1 → jamais de coupure en 3 lignes */
  headlineNeutralWrap: {
    alignSelf: 'center',
    width: screenWidth - 48,
    maxWidth: screenWidth - 48,
  },
  headlineNeutralLine1: {
    textAlign: 'center',
    fontSize: scale(18),
    lineHeight: scale(24),
    letterSpacing: -0.28,
    color: '#1C1C1E',
    textShadowColor: 'rgba(255,255,255,1)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  headlineCount: {
    color: ACCENT,
  },
  headlineHeart: {
    color: PAYWALL_HEART,
    textShadowColor: 'transparent',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0,
  },
  subline: {
    marginTop: 6,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    color: MUTED,
    alignSelf: 'center',
    maxWidth: screenWidth - 56,
  },
  neutralHeadlineSpacer: {
    height: verticalScale(12),
  },
  benefitsCard: {
    marginTop: verticalScale(12),
    backgroundColor: CARD,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: LINE,
    paddingVertical: 0,
    paddingHorizontal: 0,
    overflow: 'hidden',
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  benefitIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginTop: 2,
    backgroundColor: ACCENT_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitInfinityGlyph: {
    fontSize: 17,
    fontWeight: '600',
    color: ACCENT,
    lineHeight: 20,
    marginTop: -1,
  },
  cloudLock: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  miniLock: {
    position: 'absolute',
    bottom: 3,
    right: 3,
  },
  benefitCopy: {
    flex: 1,
    minWidth: 0,
  },
  benefitTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  benefitDesc: {
    marginTop: 4,
    fontSize: 12,
    color: MUTED,
    lineHeight: 16,
  },
  benefitRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: LINE,
    marginLeft: 44,
    marginRight: 10,
  },
  plansRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: verticalScale(10),
    alignItems: 'stretch',
  },
  planCard: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderWidth: 1.5,
    minHeight: 0,
    justifyContent: 'center',
  },
  planCardSelected: {
    borderColor: ACCENT,
    backgroundColor: THEME.surfaceCard,
  },
  planCardIdle: {
    borderColor: 'rgba(0,0,0,0.1)',
    backgroundColor: CARD,
  },
  planSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  planPriceBlock: {
    flex: 1,
    minWidth: 0,
  },
  planNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  planName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1C1C1E',
    lineHeight: 16,
  },
  planDiscountPill: {
    backgroundColor: 'rgba(253, 119, 100, 0.16)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
  },
  planDiscountPillText: {
    color: ACCENT,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 13,
  },
  planPriceMain: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    lineHeight: 20,
  },
  planPriceMainYear: {
    color: ACCENT,
  },
  planPriceMainMonth: {
    color: '#1C1C1E',
  },
  planPerMoInline: {
    fontSize: 12,
    fontWeight: '600',
    color: MUTED,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(0,0,0,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterOn: {
    borderColor: ACCENT,
  },
  radioInner: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: ACCENT,
  },
  planFine: {
    marginTop: 1,
    fontSize: 11,
    color: MUTED,
    lineHeight: 14,
  },
  primaryCta: {
    marginTop: verticalScale(22),
    height: 54,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: THEME.captureCtaBorderColor,
  },
  primaryCtaInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryCtaText: {
    color: THEME.captureScreenCtaForeground,
    fontSize: 16,
    fontWeight: '700',
  },
  dismissCta: {
    marginTop: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  dismissCtaText: {
    fontSize: 15,
    fontWeight: '600',
    color: MUTED,
    textAlign: 'center',
  },
  finePrint: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 11,
    lineHeight: 15,
    color: '#A0A4AB',
  },
})
