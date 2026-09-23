/**
 * Flag UX « problème de paiement » (app_metadata.billingIssue via webhook RC).
 * Cache AsyncStorage pour peindre sans attendre le réseau.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';

const STORAGE_KEY = 'petitmo:billingIssue';

let memoryFlag: boolean | null = null;

export function peekBillingIssue(): boolean {
  return memoryFlag === true;
}

export async function getBillingIssueCached(): Promise<boolean> {
  if (memoryFlag != null) return memoryFlag;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    memoryFlag = raw === '1';
  } catch {
    memoryFlag = false;
  }
  return memoryFlag;
}

export async function setBillingIssueLocal(active: boolean): Promise<void> {
  memoryFlag = active;
  try {
    if (active) await AsyncStorage.setItem(STORAGE_KEY, '1');
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* */
  }
}

export function billingIssueFromUser(user: User | null | undefined): boolean {
  const raw = user?.app_metadata?.billingIssue;
  return raw === true || raw === 'true' || raw === 1;
}

/** Aligne le cache UX depuis la session Auth. */
export async function syncBillingIssueFromUser(user: User | null | undefined): Promise<boolean> {
  const active = billingIssueFromUser(user);
  await setBillingIssueLocal(active);
  return active;
}
