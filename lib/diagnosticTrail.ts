/**
 * Anneau local d’événements pour diagnostiquer un « ça marche pas »
 * sans se fier au texte de la maman. Aucun contenu souvenir / GPS / PII.
 */

export type TrailEventType = 'nav' | 'action' | 'error' | 'warn';

export type TrailEvent = {
  ts: string;
  type: TrailEventType;
  name: string;
  detail?: string;
};

const MAX_EVENTS = 40;
const SUPPORT_TAIL = 15;

const ring: TrailEvent[] = [];

function sanitizeDetail(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (!s) return undefined;
  /** Couper URLs / chemins longs et limiter la taille. */
  return s.slice(0, 120);
}

export function pushTrail(
  type: TrailEventType,
  name: string,
  detail?: unknown,
): void {
  const n = String(name ?? '').trim().slice(0, 80);
  if (!n) return;
  ring.push({
    ts: new Date().toISOString(),
    type,
    name: n,
    detail: sanitizeDetail(detail),
  });
  while (ring.length > MAX_EVENTS) {
    ring.shift();
  }
}

export function getTrailSnapshot(limit = MAX_EVENTS): TrailEvent[] {
  const n = Math.max(1, Math.min(limit, MAX_EVENTS));
  return ring.slice(-n).map(e => ({ ...e }));
}

export function formatTrailForSupport(limit = SUPPORT_TAIL): string {
  const events = getTrailSnapshot(limit);
  if (events.length === 0) return '(parcours vide)';
  return events
    .map(e => {
      const t = e.ts.slice(11, 19); // HH:MM:SS
      const d = e.detail ? ` · ${e.detail}` : '';
      return `${t} [${e.type}] ${e.name}${d}`;
    })
    .join('\n');
}

/** Navigation — aussi poussée vers Sentry si dispo (import lazy pour éviter cycles). */
export function recordNav(pathname: string): void {
  const path = String(pathname ?? '').trim() || '/';
  pushTrail('nav', path);
  void import('@/lib/sentry')
    .then(({ isSentryEnabled, Sentry }) => {
      if (!isSentryEnabled()) return;
      Sentry.addBreadcrumb({
        category: 'navigation',
        message: path,
        level: 'info',
      });
    })
    .catch(() => {});
}

export function recordAction(name: string, detail?: unknown): void {
  pushTrail('action', name, detail);
  void import('@/lib/sentry')
    .then(({ isSentryEnabled, Sentry }) => {
      if (!isSentryEnabled()) return;
      Sentry.addBreadcrumb({
        category: 'action',
        message: name,
        data: detail != null ? { detail: sanitizeDetail(detail) } : undefined,
        level: 'info',
      });
    })
    .catch(() => {});
}

export function recordWarn(name: string, detail?: unknown): void {
  pushTrail('warn', name, detail);
  void import('@/lib/sentry')
    .then(({ isSentryEnabled, Sentry }) => {
      if (!isSentryEnabled()) return;
      Sentry.addBreadcrumb({
        category: 'warn',
        message: name,
        data: detail != null ? { detail: sanitizeDetail(detail) } : undefined,
        level: 'warning',
      });
    })
    .catch(() => {});
}

/**
 * Erreur attrapée (hotspot) → trail + Sentry.captureException.
 * `scope` = code court (ex. sync.flush, capture.photo).
 */
export function recordCaughtError(scope: string, err: unknown): void {
  const msg =
    err instanceof Error
      ? err.message.slice(0, 120)
      : String(err ?? 'unknown').slice(0, 120);
  pushTrail('error', scope, msg);
  void import('@/lib/sentry')
    .then(({ isSentryEnabled, Sentry }) => {
      if (!isSentryEnabled()) return;
      Sentry.addBreadcrumb({
        category: 'error',
        message: scope,
        data: { detail: msg },
        level: 'error',
      });
      const toCapture =
        err instanceof Error ? err : new Error(`${scope}: ${msg}`);
      Sentry.captureException(toCapture, {
        tags: { 'app.errorScope': scope.slice(0, 40) },
      });
    })
    .catch(() => {});
}
