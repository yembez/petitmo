import { getLocalChild } from '@/lib/localDb';
import { isGenericPrintBookTitle, type PrintOrderStatus, type PrintOrderSummary } from '@/lib/printOrderSummary';

export function orderBookTitle(
  order: PrintOrderSummary,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const titled = order.bookTitle.trim();
  if (titled && !isGenericPrintBookTitle(titled)) return titled;
  const childName = order.childId.trim()
    ? (getLocalChild(order.childId)?.name ?? '').trim()
    : '';
  if (childName) return t('parent.orders.journalOf', { name: childName });
  return t('parent.orders.untitledBook');
}

export function printOrderStatusLabel(
  status: PrintOrderStatus,
  t: (key: string) => string,
): string {
  switch (status) {
    case 'printing':
      return t('parent.orders.statusPrinting');
    case 'shipped':
      return t('parent.orders.statusShipped');
    case 'in_transit':
      return t('parent.orders.statusInTransit');
    case 'delivered':
      return t('parent.orders.statusDelivered');
    case 'failed':
      return t('parent.orders.statusFailed');
    case 'refunded':
      return t('parent.orders.statusRefunded');
    case 'returned':
      return t('parent.orders.statusReturned');
    default:
      return t('parent.orders.statusPaid');
  }
}
