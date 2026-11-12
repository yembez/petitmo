/**
 * Debug flash / blancs fil (Metro vs régression) — ring buffer + Share.
 *
 * Parcours QA :
 * 1. Appui long (~1,2 s) sur le titre du header Fil → active la barre debug
 * 2. Repro (import multi-photos, scroll rapide, blancs)
 * 3. À chaque blanc : « J’ai vu le flash »
 * 4. « Exporter » → Share → coller le dump dans Cursor
 *
 * Tags utiles : fil.data | fil.opacity | fil.import | fil.mvc | fil.blankWatch |
 * fil.jsStall | row.mount | row.unmount | USER_SAW_FLASH | restore.* | autoplay.*
 */
import { Share } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'petitmo:feedFlashDebug';
/** Enquête import ×N : buffer un peu plus large. */
const MAX_EVENTS = 800;

/** Heartbeat JS : gap au-delà = thread JS bloqué (souvent Metro / sync lourd). */
const JS_STALL_TICK_MS = 1000;
const JS_STALL_GAP_MS = 800;

export type FeedFlashDebugEvent = {
  t: number;
  tag: string;
  data?: Record<string, string | number | boolean | null | undefined>;
};

let enabled = false;
const events: FeedFlashDebugEvent[] = [];
const listeners = new Set<() => void>();
let jsStallTimer: ReturnType<typeof setInterval> | null = null;
let jsStallLastTick = 0;

function emit(): void {
  for (const l of listeners) l();
}

function stopJsStallMonitor(): void {
  if (jsStallTimer) {
    clearInterval(jsStallTimer);
    jsStallTimer = null;
  }
  jsStallLastTick = 0;
}

function startJsStallMonitor(): void {
  stopJsStallMonitor();
  jsStallLastTick = Date.now();
  jsStallTimer = setInterval(() => {
    if (!enabled) return;
    const now = Date.now();
    const gap = now - jsStallLastTick;
    jsStallLastTick = now;
    if (gap > JS_STALL_TICK_MS + JS_STALL_GAP_MS) {
      feedFlashLog('fil.jsStall', { gapMs: gap, tickMs: JS_STALL_TICK_MS });
    }
  }, JS_STALL_TICK_MS);
}

export function isFeedFlashDebugEnabled(): boolean {
  return enabled;
}

export function subscribeFeedFlashDebug(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Release / TestFlight / OTA : jamais de ring buffer ni jsStall (coût UI). */
async function forceOffForProduction(): Promise<void> {
  enabled = false;
  stopJsStallMonitor();
  clearFeedFlashDebugEvents();
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export async function hydrateFeedFlashDebug(): Promise<void> {
  if (!__DEV__) {
    await forceOffForProduction();
    return;
  }
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    enabled = v === '1';
  } catch {
    enabled = false;
  }
  if (enabled) startJsStallMonitor();
  else stopJsStallMonitor();
  emit();
}

export async function setFeedFlashDebugEnabled(next: boolean): Promise<void> {
  if (!__DEV__) {
    await forceOffForProduction();
    return;
  }
  enabled = next;
  try {
    if (next) await AsyncStorage.setItem(STORAGE_KEY, '1');
    else await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (next) {
    startJsStallMonitor();
    feedFlashLog('debug.on', {
      probe: 'fil-blank-import-scroll',
      maxEvents: MAX_EVENTS,
    });
  } else {
    stopJsStallMonitor();
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

/** Préfixe court pour logs (pas d’URL complète / PII). */
export function feedFlashUriKind(uri: string | null | undefined): string {
  const t = (uri ?? '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return 'https';
  if (t.includes('poster_print')) return 'posterPrint';
  if (t.includes('poster')) return 'poster';
  if (t.includes('petitmo_feed_local_videos')) return 'feedCopy';
  if (t.includes('petitmo_memories')) return 'sandbox';
  if (t.startsWith('file:')) return 'file';
  return 'other';
}
