/**
 * Fil d’Ariadne Sentry pour le flux impression (commande → stash → Gelato).
 * Sans ça on marche à l’aveugle sur les paid sans payload.
 */
import { isSentryEnabled, Sentry } from '@/lib/sentry';

export function printBreadcrumb(
  message: string,
  data?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isSentryEnabled()) return;
  try {
    Sentry.addBreadcrumb({
      category: 'print.flow',
      message,
      level: 'info',
      data: data
        ? Object.fromEntries(
            Object.entries(data).filter(([, v]) => v !== undefined).map(([k, v]) => [k, v ?? null]),
          )
        : undefined,
    });
  } catch {
    /* ignore */
  }
}

export function printCaptureError(
  scope: string,
  err: unknown,
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isSentryEnabled()) return;
  try {
    const error = err instanceof Error ? err : new Error(String(err ?? scope));
    Sentry.captureException(error, {
      tags: { 'app.errorScope': scope },
      extra: {
        message: error.message.slice(0, 400),
        ...extra,
      },
    });
  } catch {
    /* ignore */
  }
}

export function printCaptureMessage(
  scope: string,
  message: string,
  level: 'warning' | 'error' = 'warning',
  extra?: Record<string, string | number | boolean | null | undefined>,
): void {
  if (!isSentryEnabled()) return;
  try {
    Sentry.captureMessage(message, {
      level,
      tags: { 'app.errorScope': scope },
      extra,
    });
  } catch {
    /* ignore */
  }
}
