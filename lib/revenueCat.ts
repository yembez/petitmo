/**
 * RevenueCat / StoreKit — abonnements Petitmo+ uniquement.
 * Stripe n’a aucun rôle ici (livres imprimés seulement).
 *
 * Env :
 * - EXPO_PUBLIC_REVENUECAT_IOS_API_KEY
 * - EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY
 * - EXPO_PUBLIC_RC_ENTITLEMENT_ID (défaut: premium)
 * Produits ASC / RC : petitmo_plus_monthly, petitmo_plus_yearly
 */
import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  PACKAGE_TYPE,
  PURCHASES_ERROR_CODE,
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';
import { setUserTier, type UserTier } from '@/lib/userTier';
import { DEFAULT_APP_LANGUAGE } from '@/lib/i18nTypes';
import { formatAppCurrency } from '@/utils/appLocale';

export type PetitmoPlusPlan = 'monthly' | 'yearly';

const PRODUCT_ID_MONTHLY = 'petitmo_plus_monthly';
const PRODUCT_ID_YEARLY = 'petitmo_plus_yearly';
/** Identifiants fréquents du Test Store / packages RC par défaut. */
const PRODUCT_ID_MONTHLY_ALIASES = [PRODUCT_ID_MONTHLY, 'monthly', '$rc_monthly'] as const;
const PRODUCT_ID_YEARLY_ALIASES = [PRODUCT_ID_YEARLY, 'yearly', 'annual', '$rc_annual'] as const;

let configured = false;
let customerInfoListenerAttached = false;

function iosApiKey(): string {
  return (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY ?? '').trim();
}

function androidApiKey(): string {
  return (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? '').trim();
}

export function revenueCatApiKeyForPlatform(): string {
  if (Platform.OS === 'ios') return iosApiKey();
  if (Platform.OS === 'android') return androidApiKey();
  return '';
}

export function isRevenueCatConfigured(): boolean {
  return configured && revenueCatApiKeyForPlatform().length > 0;
}

export function petitmoPlusEntitlementId(): string {
  const raw = (process.env.EXPO_PUBLIC_RC_ENTITLEMENT_ID ?? 'petitmo_plus').trim();
  return raw || 'petitmo_plus';
}

export function hasPetitmoPlusEntitlement(info: CustomerInfo | null | undefined): boolean {
  if (!info) return false;
  const id = petitmoPlusEntitlementId();
  return Boolean(info.entitlements.active[id]);
}

export async function applyUserTierFromCustomerInfo(info: CustomerInfo): Promise<UserTier> {
  const tier: UserTier = hasPetitmoPlusEntitlement(info) ? 'paid' : 'free';
  await setUserTier(tier);
  try {
    const { applyLocalArchiveForTier } = await import('@/services/memoryArchiveLocal');
    applyLocalArchiveForTier(tier);
  } catch (e) {
    console.warn('[revenueCat] local archive', e);
  }
  if (tier === 'paid') {
    try {
      const { setBillingIssueLocal } = await import('@/lib/billingIssue');
      await setBillingIssueLocal(false);
    } catch {
      /* */
    }
    try {
      const { setCaptureLockedLocal } = await import('@/lib/captureLock');
      await setCaptureLockedLocal(false);
      const { invalidateMemoryLimitCache } = await import('@/lib/limits');
      invalidateMemoryLimitCache();
    } catch {
      /* */
    }
  }
  return tier;
}

function attachCustomerInfoListenerOnce(): void {
  if (customerInfoListenerAttached) return;
  customerInfoListenerAttached = true;
  Purchases.addCustomerInfoUpdateListener(info => {
    void applyUserTierFromCustomerInfo(info).catch(e => {
      console.warn('[revenueCat] customerInfo listener', e);
    });
  });
}

/**
 * Init silencieuse au premier lancement (anonyme côté RC).
 * Sans clé API : no-op (paywall affichera une erreur claire).
 */
export async function configureRevenueCat(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const apiKey = revenueCatApiKeyForPlatform();
  if (!apiKey) {
    if (__DEV__) {
      console.warn(
        '[revenueCat] Clé API manquante (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY / ANDROID). IAP désactivé.',
      );
    }
    return false;
  }
  if (configured) {
    attachCustomerInfoListenerOnce();
    return true;
  }
  try {
    if (__DEV__) {
      Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    }
    Purchases.configure({ apiKey });
    configured = true;
    attachCustomerInfoListenerOnce();
    return true;
  } catch (e) {
    console.warn('[revenueCat] configure failed', e);
    return false;
  }
}

/** Lie l’app user RC à l’id Supabase Auth (compte produit). */
export async function logInRevenueCat(supabaseUserId: string): Promise<CustomerInfo | null> {
  const uid = supabaseUserId.trim();
  if (!uid) return null;
  const ok = await configureRevenueCat();
  if (!ok) return null;
  try {
    const { customerInfo } = await Purchases.logIn(uid);
    await applyUserTierFromCustomerInfo(customerInfo);
    return customerInfo;
  } catch (e) {
    console.warn('[revenueCat] logIn', e);
    return null;
  }
}

export async function logOutRevenueCat(): Promise<void> {
  if (!configured) return;
  try {
    const info = await Purchases.logOut();
    await applyUserTierFromCustomerInfo(info);
  } catch (e) {
    console.warn('[revenueCat] logOut', e);
  }
}

export async function refreshRevenueCatCustomerInfo(): Promise<CustomerInfo | null> {
  const ok = await configureRevenueCat();
  if (!ok) return null;
  try {
    const info = await Purchases.getCustomerInfo();
    await applyUserTierFromCustomerInfo(info);
    return info;
  } catch (e) {
    console.warn('[revenueCat] getCustomerInfo', e);
    return null;
  }
}

function pickPackageForPlan(
  packages: PurchasesPackage[],
  plan: PetitmoPlusPlan,
): PurchasesPackage | null {
  const aliases = plan === 'yearly' ? PRODUCT_ID_YEARLY_ALIASES : PRODUCT_ID_MONTHLY_ALIASES;
  const byProduct = packages.find(p =>
    aliases.some(id => p.product.identifier === id || p.identifier === id),
  );
  if (byProduct) return byProduct;

  const byType =
    plan === 'yearly'
      ? packages.find(p => p.packageType === PACKAGE_TYPE.ANNUAL)
      : packages.find(p => p.packageType === PACKAGE_TYPE.MONTHLY);
  return byType ?? null;
}

export type PetitmoPlusPlanPrices = {
  monthlyPriceString: string;
  yearlyPriceString: string;
  /** Ex. « 4,16 € » — null si incalculable. */
  yearlyPerMonthString: string | null;
  /** Remise annuelle vs 12× mensuel, arrondie ; null si incalculable. */
  yearlyDiscountPercent: number | null;
  /** Code devise StoreKit (ex. EUR, USD) — pour debug / affichage. */
  currencyCode: string | null;
};

function formatStorePrice(amount: number, currencyCode: string | null | undefined): string {
  const code = (currencyCode ?? 'EUR').trim() || 'EUR';
  return formatAppCurrency(amount, DEFAULT_APP_LANGUAGE, code);
}

/** Prix localisés de l’offering courant (Test Store ou App Store). */
export async function fetchPetitmoPlusPlanPrices(): Promise<PetitmoPlusPlanPrices | null> {
  const ok = await configureRevenueCat();
  if (!ok) return null;
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current?.availablePackages?.length) return null;

    const monthlyPkg = pickPackageForPlan(current.availablePackages, 'monthly');
    const yearlyPkg = pickPackageForPlan(current.availablePackages, 'yearly');
    if (!monthlyPkg || !yearlyPkg) return null;

    const monthlyPrice = monthlyPkg.product.price;
    const yearlyPrice = yearlyPkg.product.price;
    const currencyCode =
      monthlyPkg.product.currencyCode?.trim() ||
      yearlyPkg.product.currencyCode?.trim() ||
      null;

    let yearlyDiscountPercent: number | null = null;
    if (
      typeof monthlyPrice === 'number' &&
      typeof yearlyPrice === 'number' &&
      monthlyPrice > 0 &&
      yearlyPrice > 0
    ) {
      const fullYear = monthlyPrice * 12;
      if (fullYear > yearlyPrice) {
        yearlyDiscountPercent = Math.round((1 - yearlyPrice / fullYear) * 100);
      }
    }

    const yearlyPerMonth =
      typeof yearlyPrice === 'number' && yearlyPrice > 0 ? yearlyPrice / 12 : null;

    return {
      monthlyPriceString: formatStorePrice(monthlyPrice, currencyCode),
      yearlyPriceString: formatStorePrice(yearlyPrice, currencyCode),
      yearlyPerMonthString:
        yearlyPerMonth != null ? formatStorePrice(yearlyPerMonth, currencyCode) : null,
      yearlyDiscountPercent,
      currencyCode,
    };
  } catch (e) {
    console.warn('[revenueCat] fetchPetitmoPlusPlanPrices', e);
    return null;
  }
}

export type PurchasePetitmoPlusResult =
  | { ok: true; customerInfo: CustomerInfo }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled: false; message: string };

export async function purchasePetitmoPlusPlan(
  plan: PetitmoPlusPlan,
): Promise<PurchasePetitmoPlusResult> {
  const ok = await configureRevenueCat();
  if (!ok) {
    return {
      ok: false,
      cancelled: false,
      message:
        'Achats non configurés. Ajoute la clé RevenueCat (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY) puis rebuild natif.',
    };
  }

  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    if (!current || current.availablePackages.length === 0) {
      return {
        ok: false,
        cancelled: false,
        message: 'Aucune offre Petitmo+ disponible. Vérifie RevenueCat / App Store Connect.',
      };
    }

    const pkg = pickPackageForPlan(current.availablePackages, plan);
    if (!pkg) {
      return {
        ok: false,
        cancelled: false,
        message:
          plan === 'yearly'
            ? `Produit annuel introuvable (${PRODUCT_ID_YEARLY}).`
            : `Produit mensuel introuvable (${PRODUCT_ID_MONTHLY}).`,
      };
    }

    const { customerInfo } = await Purchases.purchasePackage(pkg);
    if (!hasPetitmoPlusEntitlement(customerInfo)) {
      return {
        ok: false,
        cancelled: false,
        message: 'Achat terminé mais l’accès Petitmo+ n’est pas encore actif. Réessaie ou restaure les achats.',
      };
    }
    await applyUserTierFromCustomerInfo(customerInfo);
    return { ok: true, customerInfo };
  } catch (e: unknown) {
    const err = e as { userCancelled?: boolean; code?: string; message?: string };
    if (
      err?.userCancelled === true ||
      err?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR
    ) {
      return { ok: false, cancelled: true };
    }
    const message =
      typeof err?.message === 'string' && err.message.trim()
        ? err.message.trim()
        : "Impossible de finaliser l'achat.";
    return { ok: false, cancelled: false, message };
  }
}

export async function restorePetitmoPlusPurchases(): Promise<PurchasePetitmoPlusResult> {
  const ok = await configureRevenueCat();
  if (!ok) {
    return {
      ok: false,
      cancelled: false,
      message: 'Achats non configurés (clé RevenueCat manquante).',
    };
  }
  try {
    const customerInfo = await Purchases.restorePurchases();
    await applyUserTierFromCustomerInfo(customerInfo);
    if (!hasPetitmoPlusEntitlement(customerInfo)) {
      return {
        ok: false,
        cancelled: false,
        message: 'Aucun abonnement Petitmo+ à restaurer sur ce compte Apple / Google.',
      };
    }
    return { ok: true, customerInfo };
  } catch (e: unknown) {
    const message =
      e instanceof Error && e.message.trim()
        ? e.message.trim()
        : 'Impossible de restaurer les achats.';
    return { ok: false, cancelled: false, message };
  }
}
