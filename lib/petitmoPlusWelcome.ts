/**
 * Bienvenue Petit Cœur + après achat / restore réussi.
 * Flag mémoire (+ AsyncStorage) pour afficher l’overlay une fois après navigation.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

const STORAGE_KEY = 'petitmo:plusWelcomePending';
export const PETITMO_PLUS_WELCOME_EVENT = 'petitmo:plus-welcome';

let pendingMemory = false;

/** Marque qu’il faut montrer l’overlay (après leave paywall). */
export async function markPetitmoPlusWelcomePending(): Promise<void> {
  pendingMemory = true;
  try {
    await AsyncStorage.setItem(STORAGE_KEY, '1');
  } catch {
    /* */
  }
  DeviceEventEmitter.emit(PETITMO_PLUS_WELCOME_EVENT);
}

export function peekPetitmoPlusWelcomePending(): boolean {
  return pendingMemory;
}

export async function hydratePetitmoPlusWelcomePending(): Promise<boolean> {
  if (pendingMemory) return true;
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    pendingMemory = v === '1';
  } catch {
    pendingMemory = false;
  }
  return pendingMemory;
}

/** Consomme le flag (après fermeture CTA). */
export async function clearPetitmoPlusWelcomePending(): Promise<void> {
  pendingMemory = false;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* */
  }
}
