import { useEffect, useRef } from 'react';

const TAG = '[BookPortraitPerf]';

/** Actif en __DEV__ par défaut. Désactiver : `EXPO_PUBLIC_BOOK_PORTRAIT_PERF=0` */
export function isBookPortraitPerfEnabled(): boolean {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return false;
  return process.env.EXPO_PUBLIC_BOOK_PORTRAIT_PERF !== '0';
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

const renderCounts = new Map<string, number>();
const memoSkipCounts = new Map<string, number>();
const prefetchedUris = new Set<string>();

let scrollLogThrottleAt = 0;
let fpsRaf = 0;
let fpsFrames = 0;
let fpsWindowStart = 0;
let fpsJankCount = 0;
let fpsLastFrame = 0;

function log(category: string, message: string, data?: Record<string, unknown>): void {
  if (!isBookPortraitPerfEnabled()) return;
  const payload = data ? ` ${JSON.stringify(data)}` : '';
  console.log(`${TAG}:${category}`, message + payload);
}

export function bookPortraitPerfRender(component: string, detail: Record<string, unknown> = {}): void {
  if (!isBookPortraitPerfEnabled()) return;
  const n = (renderCounts.get(component) ?? 0) + 1;
  renderCounts.set(component, n);
  log('render', `${component} #${n}`, { ...detail, atMs: Math.round(nowMs()) });
}

export function bookPortraitPerfMemoSkip(component: string, detail: Record<string, unknown> = {}): void {
  if (!isBookPortraitPerfEnabled()) return;
  const n = (memoSkipCounts.get(component) ?? 0) + 1;
  memoSkipCounts.set(component, n);
  if (n <= 3 || n % 25 === 0) {
    log('memo-skip', `${component} #${n}`, detail);
  }
}

export function bookPortraitPerfMemoBreak(component: string, changed: string[]): void {
  if (!isBookPortraitPerfEnabled()) return;
  log('memo-break', component, { changed });
}

export function bookPortraitPerfState(key: string, detail?: Record<string, unknown>): void {
  log('state', key, detail);
}

export function bookPortraitPerfScroll(event: string, detail: Record<string, unknown> = {}): void {
  if (!isBookPortraitPerfEnabled()) return;
  if (event === 'scroll') {
    const t = Date.now();
    if (t - scrollLogThrottleAt < 120) return;
    scrollLogThrottleAt = t;
  }
  log('scroll', event, detail);
}

export function bookPortraitPerfListRender(spreadIndex: number, leftPage?: number, rightPage?: number): void {
  log('list', `renderItem spread=${spreadIndex}`, { leftPage, rightPage });
}

export function bookPortraitPerfPrefetch(uri: string | null | undefined, source: string): void {
  if (!uri?.trim()) return;
  const trimmed = uri.trim();
  const duplicate = prefetchedUris.has(trimmed);
  if (!duplicate) prefetchedUris.add(trimmed);
  log('prefetch', duplicate ? 'duplicate' : 'new', {
    source,
    duplicate,
    uri: trimmed.length > 96 ? `${trimmed.slice(0, 96)}…` : trimmed,
  });
}

export function bookPortraitPerfNetwork(op: string, detail: Record<string, unknown> = {}): void {
  log('network', op, detail);
}

export function bookPortraitPerfTiming(label: string, startedAt: number, detail?: Record<string, unknown>): void {
  log('timing', label, { ms: Math.round(nowMs() - startedAt), ...detail });
}

export function bookPortraitPerfStartScrollMonitor(): void {
  if (!isBookPortraitPerfEnabled()) return;
  bookPortraitPerfStopScrollMonitor();
  fpsFrames = 0;
  fpsJankCount = 0;
  fpsWindowStart = nowMs();
  fpsLastFrame = fpsWindowStart;

  const tick = (t: number) => {
    const gap = t - fpsLastFrame;
    if (gap > 48) {
      fpsJankCount++;
      log('jank', `frame gap ${Math.round(gap)}ms`, { totalJanks: fpsJankCount });
    }
    fpsLastFrame = t;
    fpsFrames++;
    if (t - fpsWindowStart >= 1000) {
      log('fps', `${fpsFrames} fps`, { janks: fpsJankCount });
      fpsFrames = 0;
      fpsJankCount = 0;
      fpsWindowStart = t;
    }
    fpsRaf = requestAnimationFrame(tick);
  };
  fpsRaf = requestAnimationFrame(tick);
  log('monitor', 'scroll-fps started');
}

export function bookPortraitPerfStopScrollMonitor(): void {
  if (fpsRaf) {
    cancelAnimationFrame(fpsRaf);
    fpsRaf = 0;
    log('monitor', 'scroll-fps stopped');
  }
}

export function bookPortraitPerfDumpSummary(): void {
  if (!isBookPortraitPerfEnabled()) return;
  log('summary', 'render counts', Object.fromEntries(renderCounts));
  log('summary', 'memo-skip counts', Object.fromEntries(memoSkipCounts));
  log('summary', 'prefetch unique uris', { count: prefetchedUris.size });
}

/** Trace les deps qui changent entre renders (parent book-preview). */
export function useBookPortraitPerfTrace(
  label: string,
  deps: Record<string, unknown>,
  enabled = true,
): void {
  const prevRef = useRef<Record<string, unknown> | null>(null);

  useEffect(() => {
    if (!enabled || !isBookPortraitPerfEnabled()) return;
    const prev = prevRef.current;
    if (prev) {
      const changed: string[] = [];
      const details: Record<string, unknown> = {};
      for (const key of Object.keys(deps)) {
        if (prev[key] !== deps[key]) {
          changed.push(key);
          const a = prev[key];
          const b = deps[key];
          if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
            details[key] = 'ref-changed';
          } else {
            details[key] = { from: summarizeValue(a), to: summarizeValue(b) };
          }
        }
      }
      if (changed.length > 0) {
        bookPortraitPerfState(`${label}:deps`, { changed, details });
      }
    }
    prevRef.current = { ...deps };
  });
}

function summarizeValue(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === 'string') return v.length > 48 ? `${v.slice(0, 48)}…` : v;
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return `array(${v.length})`;
  if (typeof v === 'object') return 'object';
  return typeof v;
}

export function diffPortraitRowProps(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): string[] {
  const keys = [
    'item',
    'pageW',
    'pageH',
    'child',
    'familyChildren',
    'coverYearLabel',
    'coverTitleLine',
    'chapterTitleLine',
    'coverPhotoBrowseUri',
    'cropDpiMetaCover',
    'photoCrops',
    'rotations',
    'typography',
    'folioFont',
    'memoryPhotoRefs',
    'getMemoryForPage',
    'getPrefetchUri',
    'onOpenEditor',
    'onPrefetchImage',
  ];
  const changed: string[] = [];
  for (const k of keys) {
    if (a[k] !== b[k]) changed.push(k);
  }
  return changed;
}

export function diffBrowseLeafProps(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): string[] {
  const keys = [
    'row',
    'pageW',
    'pageH',
    'child',
    'familyChildren',
    'memory',
    'coverYearLabel',
    'coverTitleLine',
    'chapterTitleLine',
    'coverPhotoBrowseUri',
    'cropDpiMetaCover',
    'photoCrops',
    'rotations',
    'typography',
    'folioFont',
    'memoryPhotoRef',
    'prefetchUri',
    'onOpenEditor',
    'onPrefetchImage',
  ];
  const changed: string[] = [];
  for (const k of keys) {
    if (a[k] !== b[k]) changed.push(k);
  }
  return changed;
}
