import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, DeviceEventEmitter } from 'react-native';
import { Package } from 'lucide-react-native';
import ParentSubpageShell from '@/components/parentSpace/ParentSubpageShell';
import { MenuGroup, MenuRow, menuIcon } from '@/components/parentSpace/menuUi';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useAppLanguage } from '@/hooks/useAppLanguage';
import { formatAppCurrency, formatAppDate } from '@/utils/appLocale';
import { FONT_SIZES, SPACING } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';
import {
  fetchPrintOrdersForAccount,
  hydratePrintOrderTitles,
  PETITMO_PRINT_ORDERS_UPDATED_EVENT,
} from '@/services/printOrders';
import { getCachedPrintOrders, peekCachedPrintOrders } from '@/lib/printOrdersCache';
import type { PrintOrderSummary } from '@/lib/printOrderSummary';
import { orderBookTitle, printOrderStatusLabel } from '@/utils/printOrderLabels';
import { useFocusEffect } from '@react-navigation/native';

export default function ParentOrdersScreen() {
  const { t } = useAppTranslation('common');
  const lang = useAppLanguage();
  const { dm500, dm600 } = useDmSansFamilyFlowFonts();
  const [orders, setOrders] = useState<PrintOrderSummary[]>(() =>
    hydratePrintOrderTitles(peekCachedPrintOrders()),
  );
  const [ordersStatusRefreshing, setOrdersStatusRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setOrders(hydratePrintOrderTitles(peekCachedPrintOrders()));
    void getCachedPrintOrders().then((cached) => setOrders(hydratePrintOrderTitles(cached)));
    setOrdersStatusRefreshing(true);
    void fetchPrintOrdersForAccount()
      .then(setOrders)
      .finally(() => setOrdersStatusRefreshing(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(PETITMO_PRINT_ORDERS_UPDATED_EVENT, () => {
      setOrders(hydratePrintOrderTitles(peekCachedPrintOrders()));
    });
    return () => sub.remove();
  }, []);

  return (
    <ParentSubpageShell title={t('parent.orders.sectionTitle')}>
      <MenuGroup titleFontFamily={dm600}>
        {orders.length === 0 ? (
          <View style={styles.emptyBlock}>
            <Text style={[styles.emptyText, dm500 ? { fontFamily: dm500 } : null]}>
              {t('parent.orders.empty')}
            </Text>
            <Text style={[styles.emptyHint, dm500 ? { fontFamily: dm500 } : null]}>
              {t('parent.orders.hint')}
            </Text>
          </View>
        ) : (
          orders.map((o, i) => {
            const when = o.createdAt
              ? formatAppDate(new Date(o.createdAt), { day: '2-digit', month: '2-digit', year: 'numeric' }, lang)
              : '';
            const price = formatAppCurrency(o.priceCents / 100, lang);
            const meta = [when, price].filter(Boolean).join(' · ');
            return (
              <MenuRow
                key={o.id}
                bordered={i > 0}
                icon={menuIcon(Package)}
                label={orderBookTitle(o, t)}
                detail={meta || undefined}
                value={printOrderStatusLabel(o.status, t)}
                valueRefreshing={ordersStatusRefreshing}
                refreshingAccessibilityLabel={t('parent.orders.statusUpdating')}
                labelFontFamily={dm500}
                showChevron={false}
              />
            );
          })
        )}
      </MenuGroup>
    </ParentSubpageShell>
  );
}

const styles = StyleSheet.create({
  emptyBlock: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    gap: verticalScale(4),
  },
  emptyText: {
    fontSize: FONT_SIZES.base,
    color: THEME.textMuted,
  },
  emptyHint: {
    fontSize: FONT_SIZES.md,
    color: THEME.textMuted,
    lineHeight: scale(20),
  },
});
