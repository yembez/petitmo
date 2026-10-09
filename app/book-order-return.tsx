import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { THEME } from '@/constants/theme';
import { getPendingBookOrderPdfPayload } from '@/lib/pendingBookOrderPdf';
import { getPendingPrintPayment } from '@/lib/pendingPrintPayment';

/** Retour Safari / Stripe Checkout → reprise commande (sans écran cœur long). */
export default function BookOrderReturnScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ canceled?: string; paid?: string }>();
  const canceled = params.canceled === '1' || params.canceled === 'true';

  useEffect(() => {
    void WebBrowser.dismissBrowser();
    let cancelled = false;
    void (async () => {
      const pendingPay = await getPendingPrintPayment();
      const pendingBook = await getPendingBookOrderPdfPayload();
      if (cancelled) return;
      const bookId = pendingPay?.bookId || pendingBook?.bookId || '';
      const childId = pendingPay?.childId || pendingBook?.childId || '';
      if (bookId && childId) {
        router.replace({
          pathname: '/book-order',
          params: {
            bookId,
            childId,
            exportMode: 'print',
            ...(canceled ? {} : { resumePayment: '1' }),
          },
        });
        return;
      }
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/(tabs)/livres');
    })();
    return () => {
      cancelled = true;
    };
  }, [canceled, router]);

  if (canceled) {
    return <View style={styles.root} />;
  }

  return (
    <View style={styles.root}>
      <ActivityIndicator size="large" color={THEME.brandCtaOrange} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bgScreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
