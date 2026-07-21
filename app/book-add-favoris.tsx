/**
 * Ancienne route stack (écran blanc / bugs nav).
 * Le picker vit en overlay dans book-preview (livre reste monté).
 */
import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

export default function BookAddFavorisLegacyRedirect() {
  const router = useRouter();
  const params = useLocalSearchParams<{ bookId?: string }>();
  const bookId = typeof params.bookId === 'string' ? params.bookId.trim() : '';

  useEffect(() => {
    if (bookId) {
      router.replace({ pathname: '/book-preview', params: { bookId } });
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/livres');
    }
  }, [bookId, router]);

  return null;
}
