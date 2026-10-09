/**
 * Debug flash fil (TF / OTA) — ring buffer + marqueur utilisateur.
 * Activé : appui long (~1,2 s) sur le titre du header Fil.
 * Exporter : bouton « Exporter » → Share → coller ici dans le chat.
 */
import { Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'petitmo:feedFlashDebug';
const MAX_EVENTS = 400;

export type FeedFlashDebugEvent = {
  t: number;
  tag: string;
  data?: Record<string, string | number | boolean | null | undefined>;
};

let enabled = false;
const events: FeedFlashDebugEvent[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function isFeedFlashDebugEnabled(): boolean {
  return enabled;
}

export function subscribeFeedFlashDebug(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export async function hydrateFeedFlashDebug(): Promise<void> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    enabled = v === '1';
  } catch {
    enabled = false;
  }
  emit();
}

export async function setFeedFlashDebugEnabled(next: boolean): Promise<void> {
  enabled = next;
  try {
    if (next) await AsyncStorage.setItem(STORAGE_KEY, '1');
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (next) {
    feedFlashLog('debug.on', {});
  }
  emit();
}

export function feedFlashLog(
  tag: string,
  data?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!enabled) return;
  const row: FeedFlashDebugEvent = { t: Date.now(), tag, data };
  events.push(row);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  const payload = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`[feedFlash] ${tag}${payload}`);
  emit();
}

/** L’utilisatrice vient de voir le flash — ancre temporelle pour corréler. */
export function feedFlashMarkSeen(): void {
  feedFlashLog('USER_SAW_FLASH', { mark: true });
}

export function getFeedFlashDebugDump(): string {
  const lines = events.map(e => {
    const d = e.data ? ` ${JSON.stringify(e.data)}` : '';
    return `${new Date(e.t).toISOString()} ${e.tag}${d}`;
  });
  return [`petitmo feedFlashDebug n=${events.length}`, ...lines].join('\n');
}

export async function shareFeedFlashDebugDump(): Promise<void> {
  const message = getFeedFlashDebugDump();
  await Share.share({
    message,
    title: 'Petitmo feedFlashDebug',
  });
}

export function clearFeedFlashDebugEvents(): void {
  events.length = 0;
  emit();
}
