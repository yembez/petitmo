import AsyncStorage from '@react-native-async-storage/async-storage';
import { parsePrintOrderList, type PrintOrderSummary } from '@/lib/printOrderSummary';

const KEY = 'petitmo_print_orders_cache_v1';

let memory: PrintOrderSummary[] | null = null;
let loadPromise: Promise<PrintOrderSummary[]> | null = null;

function rememberMemory(orders: PrintOrderSummary[]): PrintOrderSummary[] {
  memory = orders;
  return orders;
}

/** Sync — 1er paint paramètres, sans attendre AsyncStorage / le réseau. */
export function peekCachedPrintOrders(): PrintOrderSummary[] {
  return memory ?? [];
}

export async function getCachedPrintOrders(): Promise<PrintOrderSummary[]> {
  if (memory) return memory;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (!raw?.trim()) return rememberMemory([]);
      return rememberMemory(parsePrintOrderList(JSON.parse(raw)));
    } catch {
      return rememberMemory([]);
    } finally {
      loadPromise = null;
    }
  })();
  return loadPromise;
}

export async function setCachedPrintOrders(orders: PrintOrderSummary[]): Promise<void> {
  rememberMemory(orders);
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(orders));
  } catch {
    /* ignore */
  }
}

export async function rememberLocalPrintOrder(order: PrintOrderSummary): Promise<void> {
  const current = await getCachedPrintOrders();
  const next = [order, ...current.filter((o) => o.id !== order.id)].slice(0, 40);
  await setCachedPrintOrders(next);
}

void getCachedPrintOrders();
