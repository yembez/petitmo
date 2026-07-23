import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { getUserTier } from '@/lib/userTier';
import { getUserMode } from '@/lib/userMode';

/** Bloc technique collé dans les signalements bêta (mail + Sentry). */
export type BugReportContext = {
  appVersion: string;
  buildNumber: string;
  updateId: string;
  updateChannel: string;
  platform: string;
  osVersion: string;
  deviceModel: string;
  tier: string;
  userMode: string;
  pathname: string;
  locale: string;
  sentryEnabled: boolean;
  reportedAt: string;
};

function safeUpdateId(): string {
  try {
    if (!Updates.isEnabled) return 'embedded';
    return Updates.updateId?.trim() || 'embedded';
  } catch {
    return 'n/a';
  }
}

function safeUpdateChannel(): string {
  try {
    return Updates.channel?.trim() || 'n/a';
  } catch {
    return 'n/a';
  }
}

/** Uniquement `expo-constants` / `Platform` — pas de module natif neuf (compatible vieux dev client). */
function appVersionFromConstants(): string {
  return (
    Constants.nativeApplicationVersion?.trim() ||
    Constants.expoConfig?.version?.trim() ||
    '—'
  );
}

function buildNumberFromConstants(): string {
  return (
    Constants.nativeBuildVersion?.trim() ||
    (Constants.expoConfig?.ios?.buildNumber as string | undefined)?.trim() ||
    '—'
  );
}

function deviceModelFromConstants(): string {
  const m = Constants.deviceName?.trim();
  if (m) return m;
  return Platform.OS === 'ios' ? 'iPhone' : Platform.OS;
}

export async function collectBugReportContext(opts?: {
  pathname?: string;
  sentryEnabled?: boolean;
}): Promise<BugReportContext> {
  const tier = await getUserTier();
  const userMode = await getUserMode();

  return {
    appVersion: appVersionFromConstants(),
    buildNumber: buildNumberFromConstants(),
    updateId: safeUpdateId(),
    updateChannel: safeUpdateChannel(),
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    deviceModel: deviceModelFromConstants(),
    tier,
    userMode,
    pathname: (opts?.pathname ?? '').trim() || '—',
    locale: Intl.DateTimeFormat().resolvedOptions().locale || '—',
    sentryEnabled: !!opts?.sentryEnabled,
    reportedAt: new Date().toISOString(),
  };
}

/** Libellé version affiché dans l’UI (ex. 1.0.0 (6) · ota abc123). */
export function formatAppVersionLabel(
  ctx: Pick<BugReportContext, 'appVersion' | 'buildNumber' | 'updateId'>,
): string {
  const base = `${ctx.appVersion} (${ctx.buildNumber})`;
  if (!ctx.updateId || ctx.updateId === 'embedded' || ctx.updateId === 'n/a') return base;
  return `${base} · ota ${ctx.updateId.slice(0, 8)}`;
}

export function formatBugReportTechBlock(ctx: BugReportContext, sentryEventId?: string | null): string {
  const lines = [
    '--- Infos techniques (ne pas effacer) ---',
    `App: ${ctx.appVersion} (${ctx.buildNumber})`,
    `OTA: ${ctx.updateId} / channel ${ctx.updateChannel}`,
    `Device: ${ctx.deviceModel} · ${ctx.platform} ${ctx.osVersion}`,
    `Mode: ${ctx.userMode} · tier ${ctx.tier}`,
    `Écran: ${ctx.pathname}`,
    `Locale: ${ctx.locale}`,
    `Sentry: ${ctx.sentryEnabled ? 'on' : 'off'}`,
    `Horodatage: ${ctx.reportedAt}`,
  ];
  if (sentryEventId?.trim()) {
    lines.push(`Sentry event: ${sentryEventId.trim()}`);
  }
  lines.push('---------------------------------------');
  return lines.join('\n');
}

export function buildBugReportMailto(opts: {
  email: string;
  ctx: BugReportContext;
  sentryEventId?: string | null;
}): { url: string; subject: string; body: string } {
  const subject = `[Petitmo bêta] Problème ${opts.ctx.appVersion} (${opts.ctx.buildNumber})`;
  const body = [
    'Décris le problème ici (ce que tu faisais, ce que tu voyais) :',
    '',
    '',
    formatBugReportTechBlock(opts.ctx, opts.sentryEventId),
  ].join('\n');
  const url = `mailto:${opts.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  return { url, subject, body };
}
