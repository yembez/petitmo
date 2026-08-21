import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import { getLocalBook, listLocalBooks } from '@/lib/localDb';
import {
  isGenericPrintBookTitle,
  parsePrintOrderList,
  type PrintOrderSummary,
} from '@/lib/printOrderSummary';
import { getCachedPrintOrders, peekCachedPrintOrders, setCachedPrintOrders } from '@/lib/printOrdersCache';
import { DeviceEventEmitter } from 'react-native';

export const PETITMO_PRINT_ORDERS_UPDATED_EVENT = 'petitmo:print-orders-updated' as const;

function printOrdersUrl(): string {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  return `${base}/functions/v1/print-orders`;
}

function realLocalTitle(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  return t && !isGenericPrintBookTitle(t) ? t : '';
}

function titleFromLocalBooks(preferredBookId: string): { bookId: string; bookTitle: string } | null {
  const preferred = preferredBookId.trim();
  if (preferred) {
    const t = realLocalTitle(getLocalBook(preferred)?.title);
    if (t) return { bookId: preferred, bookTitle: t };
  }

  const books = listLocalBooks();
  const real = books
    .map((b) => ({
      id: b.id,
      title: realLocalTitle(b.title),
      updatedAt: Date.parse(b.updatedAt) || 0,
      memoryCount: b.memoryIds?.length ?? 0,
    }))
    .filter((b) => b.title);

  if (real.length === 0) return null;
  if (real.length === 1) return { bookId: real[0].id, bookTitle: real[0].title };

  const withMemories = real.filter((b) => b.memoryCount > 0);
  const pool = withMemories.length > 0 ? withMemories : real;
  pool.sort((a, b) => b.updatedAt - a.updatedAt);
  return { bookId: pool[0].id, bookTitle: pool[0].title };
}

export function hydratePrintOrderTitles(orders: PrintOrderSummary[]): PrintOrderSummary[] {
  return orders.map((o) => {
    const resolved = titleFromLocalBooks(o.bookId);
    if (resolved) {
      return { ...o, bookId: o.bookId.trim() || resolved.bookId, bookTitle: resolved.bookTitle };
    }
    if (isGenericPrintBookTitle(o.bookTitle)) {
      return { ...o, bookTitle: '' };
    }
    return o;
  });
}

function mergePrintOrders(
  cached: PrintOrderSummary[],
  server: PrintOrderSummary[],
): PrintOrderSummary[] {
  const byId = new Map<string, PrintOrderSummary>();
  for (const o of cached) byId.set(o.id, o);
  for (const o of server) {
    const prev = byId.get(o.id);
    byId.set(o.id, {
      ...prev,
      ...o,
      bookId: o.bookId || prev?.bookId || '',
      childId: o.childId || prev?.childId || '',
      bookTitle: o.bookTitle.trim() || prev?.bookTitle || '',
    });
  }
  return [...byId.values()].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    return tb - ta;
  });
}

let fetchInFlight: Promise<PrintOrderSummary[]> | null = null;

export async function fetchPrintOrdersForAccount(): Promise<PrintOrderSummary[]> {
  if (fetchInFlight) return fetchInFlight;
  fetchInFlight = fetchPrintOrdersForAccountOnce().finally(() => {
    fetchInFlight = null;
  });
  return fetchInFlight;
}

async function fetchPrintOrdersForAccountOnce(): Promise<PrintOrderSummary[]> {
  if (!supabaseUrl?.trim() || !supabaseAnonKey?.trim()) {
    return hydratePrintOrderTitles(await getCachedPrintOrders());
  }
  const { data } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token?.trim();
  if (!accessToken) {
    return hydratePrintOrderTitles(await getCachedPrintOrders());
  }

  const res = await fetch(printOrdersUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
    body: '{}',
  });
  if (!res.ok) {
    return hydratePrintOrderTitles(await getCachedPrintOrders());
  }
  const json = (await res.json().catch(() => ({}))) as { orders?: unknown };
  const server = parsePrintOrderList(json.orders);
  const cached = await getCachedPrintOrders();
  const merged = hydratePrintOrderTitles(
    server.length === 0 && cached.length > 0 ? cached : mergePrintOrders(cached, server),
  );
  await setCachedPrintOrders(merged);
  DeviceEventEmitter.emit(PETITMO_PRINT_ORDERS_UPDATED_EVENT);
  return merged;
}
