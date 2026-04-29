import AsyncStorage from '@react-native-async-storage/async-storage';
import { getUserTier } from '@/lib/userTier';
import type { SubscriptionTier } from '@/types/shared';

const KEY = 'petitmo_digital_pdf_export_ok';

/**
 * Tier + droit export digital serveur (spec : premium inclus, free avec achat 4,99 €).
 * TODO: valider l’achat côté serveur quand l’IAP est branché.
 */
export async function resolveServerPdfEntitlements(): Promise<{
  subscriptionTier: SubscriptionTier;
  digitalExportPaid: boolean;
}> {
  // Dev ergonomics: permettre de tester l'export serveur (Hetzner) sans paywall / achat.
  if (__DEV__) {
    return { subscriptionTier: 'premium', digitalExportPaid: true };
  }
  const tier = await getUserTier();
  if (tier === 'paid') {
    return { subscriptionTier: 'premium', digitalExportPaid: true };
  }
  try {
    const v = await AsyncStorage.getItem(KEY);
    return { subscriptionTier: 'free', digitalExportPaid: v === '1' };
  } catch {
    return { subscriptionTier: 'free', digitalExportPaid: false };
  }
}

export async function canExportBookPdfViaServer(): Promise<boolean> {
  const { subscriptionTier, digitalExportPaid } = await resolveServerPdfEntitlements();
  return subscriptionTier === 'premium' || digitalExportPaid;
}

/** Appelé après achat in-app réussi (ou stub paywall). */
export async function grantDigitalExportPurchase(): Promise<void> {
  await AsyncStorage.setItem(KEY, '1');
}
