/**
 * Détecte les « écrans blancs » d’onglets (opacity 0, loading bloqué, View vide)
 * qui ne throwent jamais → zéro Sentry sans ce watchdog.
 *
 * Pas de PII / contenu souvenir — tags techniques seulement.
 */

import { recordAction, recordWarn, getTrailSnapshot } from '@/lib/diagnosticTrail';

export type MainTabWatchName = 'fil' | 'index' | 'favoris' | 'livres';

export type TabPaintReason =
  | 'ok'
  | 'loading'
  | 'opacity0'
  | 'no_auth_blank'
  | 'no_child'
  | 'hiding_foreign'
  | 'error_boundary'
  | 'unknown_blank';

export type TabPaintSnapshot = {
  tab: MainTabWatchName;
  focused: boolean;
  /** true = l’utilisatrice voit (ou peut voir) un écran vide / figé. */
  blank: boolean;
  reason: TabPaintReason;
  detail?: string;
};

const BLANK_STUCK_MS = 1400;

let focusedTab: MainTabWatchName | null = null;
let focusAtMs = 0;
const lastPaint: Partial<Record<MainTabWatchName, TabPaintSnapshot>> = {};
const stuckTimers = new Map<MainTabWatchName, ReturnType<typeof setTimeout>>();
/** Anti-spam Sentry : 1 event / onglet / 45 s. */
const lastStuckSentAt = new Map<MainTabWatchName, number>();
const STUCK_DEDUP_MS = 45_000;

function clearStuckTimer(tab: MainTabWatchName): void {
  const t = stuckTimers.get(tab);
  if (t) clearTimeout(t);
  stuckTimers.delete(tab);
}

function scheduleStuckCheck(tab: MainTabWatchName): void {
  clearStuckTimer(tab);
  stuckTimers.set(
    tab,
    setTimeout(() => {
      stuckTimers.delete(tab);
      const paint = lastPaint[tab];
      if (!paint || paint.tab !== focusedTab) return;
      if (!paint.focused || !paint.blank) return;
      const elapsed = Date.now() - focusAtMs;
      if (elapsed < BLANK_STUCK_MS - 50) return;

      const last = lastStuckSentAt.get(tab) ?? 0;
      if (Date.now() - last < STUCK_DEDUP_MS) {
        recordWarn('tab.blank.stuck.dedup', `${tab}:${paint.reason}`);
        return;
      }
      lastStuckSentAt.set(tab, Date.now());

      const detail = [
        `tab=${tab}`,
        `reason=${paint.reason}`,
        paint.detail ? `detail=${paint.detail}` : '',
        `focusedMs=${elapsed}`,
      ]
        .filter(Boolean)
        .join(' ');
      recordWarn('tab.blank.stuck', detail);

      void import('@/lib/sentry')
        .then(({ captureTabBlankStuck }) => {
          captureTabBlankStuck({
            tab,
            reason: paint.reason,
            detail: paint.detail,
            focusedMs: elapsed,
            trail: getTrailSnapshot(12),
          });
        })
        .catch(() => {});
    }, BLANK_STUCK_MS),
  );
}

/** Appui tab bar / jumpTo — avant le focus React Navigation. */
export function recordTabPress(tab: MainTabWatchName, from?: string): void {
  recordAction('tab.press', from ? `${from}->${tab}` : tab);
}

export function recordTabFocus(tab: MainTabWatchName): void {
  focusedTab = tab;
  focusAtMs = Date.now();
  recordAction('tab.focus', tab);
  const paint = lastPaint[tab];
  if (paint?.blank) scheduleStuckCheck(tab);
  else clearStuckTimer(tab);
}

export function recordTabBlur(tab: MainTabWatchName): void {
  recordAction('tab.blur', tab);
  clearStuckTimer(tab);
  if (focusedTab === tab) focusedTab = null;
}

/**
 * Chaque onglet signale son état de paint (loading, opacity, empty…).
 * Appeler à chaque changement pertinent + sur focus.
 */
export function reportTabPaint(snap: TabPaintSnapshot): void {
  lastPaint[snap.tab] = snap;
  if (snap.focused && snap.blank) {
    recordWarn('tab.paint.blank', `${snap.tab}:${snap.reason}${snap.detail ? `:${snap.detail}` : ''}`);
    if (focusedTab === snap.tab) scheduleStuckCheck(snap.tab);
  } else if (!snap.blank) {
    clearStuckTimer(snap.tab);
  }
}

export function peekTabPaint(tab: MainTabWatchName): TabPaintSnapshot | undefined {
  return lastPaint[tab];
}
