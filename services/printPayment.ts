import { Linking } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import { isInitExportConfigured } from '@/services/initExportApi';

function printPaymentUrl(): string {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  return `${base}/functions/v1/print-payment`;
}

export function isPrintPaymentConfigured(): boolean {
  return isInitExportConfigured();
}

export type PrintPaymentStatus = 'unpaid' | 'paid' | 'failed' | 'refunded';

export type CreatePrintPaymentResult = {
  paymentStatus: PrintPaymentStatus;
  checkoutUrl?: string;
  bypassed?: boolean;
};

async function postPrintPayment(body: Record<string, unknown>): Promise<{
  status: number;
  json: Record<string, unknown>;
}> {
  if (!isPrintPaymentConfigured()) {
    throw new Error('STRIPE_UNCONFIGURED');
  }
  const res = await fetch(printPaymentUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey!,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function parseStatus(raw: unknown): PrintPaymentStatus {
  if (raw === 'paid' || raw === 'failed' || raw === 'refunded') return raw;
  return 'unpaid';
}

export async function createPrintPayment(input: {
  exportTicket: string;
  returnUrl: string;
  customerEmail?: string;
}): Promise<CreatePrintPaymentResult> {
  const { status, json } = await postPrintPayment({
    action: 'create',
    exportTicket: input.exportTicket,
    returnUrl: input.returnUrl,
    ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
  });
  if (status === 503 || json.code === 'STRIPE_UNCONFIGURED') {
    throw new Error('STRIPE_UNCONFIGURED');
  }
  if (status !== 200) {
    const msg = typeof json.error === 'string' ? json.error : `print-payment (${status})`;
    const detail = typeof json.detail === 'string' ? json.detail.trim() : '';
    throw new Error(detail && __DEV__ ? `${msg} (${detail})` : msg);
  }
  const paymentStatus = parseStatus(json.paymentStatus);
  const checkoutUrl = typeof json.checkoutUrl === 'string' ? json.checkoutUrl : undefined;
  const bypassed = json.bypassed === true;
  if (paymentStatus === 'unpaid' && !checkoutUrl && !bypassed) {
    throw new Error('Impossible de démarrer le paiement.');
  }
  return { paymentStatus, checkoutUrl, bypassed };
}

export async function fetchPrintPaymentStatus(exportTicket: string): Promise<PrintPaymentStatus> {
  const { status, json } = await postPrintPayment({
    action: 'status',
    exportTicket,
  });
  if (status !== 200) {
    throw new Error(typeof json.error === 'string' ? json.error : `print-payment status (${status})`);
  }
  return parseStatus(json.paymentStatus);
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntilPrintPaid(
  exportTicket: string,
  opts?: { attempts?: number; intervalMs?: number },
): Promise<PrintPaymentStatus> {
  const attempts = opts?.attempts ?? 15;
  const intervalMs = opts?.intervalMs ?? 2000;
  let last: PrintPaymentStatus = 'unpaid';
  for (let i = 0; i < attempts; i++) {
    last = await fetchPrintPaymentStatus(exportTicket);
    if (last === 'paid' || last === 'failed' || last === 'refunded') return last;
    await sleepMs(intervalMs);
  }
  return last;
}

export function isPrintCheckoutReturnUrl(url: string): boolean {
  return url.includes('book-order-return');
}

export function printCheckoutReturnWasCanceled(url: string): boolean {
  return /[?&]canceled=1(?:&|$)/.test(url);
}

/**
 * Ouvre Stripe Checkout et ramène dans l’app dès que le paiement est `paid`
 * (poll webhook) ou dès le deep link de retour — sans laisser Safari bloqué
 * sur une page blanche.
 */
export async function openPrintCheckoutAndWaitPaid(input: {
  checkoutUrl: string;
  exportTicket: string;
  onBrowserClosed?: (info: { canceled: boolean }) => void;
}): Promise<PrintPaymentStatus> {
  let stopPoll = false;
  let latest: PrintPaymentStatus = 'unpaid';
  let sawReturnUrl = false;
  let sawCanceled = false;
  let browserClosedNotified = false;

  const notifyBrowserClosed = () => {
    if (browserClosedNotified) return;
    browserClosedNotified = true;
    input.onBrowserClosed?.({ canceled: sawCanceled });
  };

  const onUrl = ({ url }: { url: string }) => {
    if (!isPrintCheckoutReturnUrl(url)) return;
    sawReturnUrl = true;
    if (printCheckoutReturnWasCanceled(url)) sawCanceled = true;
    notifyBrowserClosed();
    void WebBrowser.dismissBrowser();
  };

  const sub = Linking.addEventListener('url', onUrl);

  const pollPromise = (async () => {
    while (!stopPoll) {
      try {
        latest = await fetchPrintPaymentStatus(input.exportTicket);
        if (latest === 'paid' || latest === 'failed' || latest === 'refunded') {
          notifyBrowserClosed();
          await WebBrowser.dismissBrowser();
          return latest;
        }
      } catch {
        /* réseau : on continue */
      }
      await sleepMs(1200);
    }
    return latest;
  })();

  try {
    await WebBrowser.openBrowserAsync(input.checkoutUrl, {
      enableBarCollapsing: false,
      showTitle: true,
      dismissButtonStyle: 'close',
    });
  } catch {
    /* statut ci-dessous */
  } finally {
    stopPoll = true;
    sub.remove();
    notifyBrowserClosed();
  }

  if (sawCanceled && latest === 'unpaid') {
    return 'unpaid';
  }
  if (latest === 'paid' || latest === 'failed' || latest === 'refunded') {
    return latest;
  }

  void pollPromise;
  const extraAttempts = sawReturnUrl && !sawCanceled ? 12 : 6;
  return waitUntilPrintPaid(input.exportTicket, {
    attempts: extraAttempts,
    intervalMs: 1000,
  });
}
