import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { BookOpen } from 'lucide-react-native';
import { scale } from '@/utils/responsive';
import type { Book } from '@/services/books';
import { resolveBookListRowCoverUri } from '@/services/books';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { normalizeMemoryMediaUriForDisplay } from '@/utils/memoryPhotos';

type ModalBookCoverThumbProps = {
  book: Book;
  /** Repli si aucune couverture résolue (ex. photo profil enfant). */
  fallbackUri?: string;
};

/** Vignette couverture livre — parité pipeline `app/(tabs)/livres.tsx`. */
export function ModalBookCoverThumb({ book, fallbackUri = '' }: ModalBookCoverThumbProps) {
  const coverRaw = resolveBookListRowCoverUri(book);
  const coverSigned = useSignedMediaUrl(coverRaw || null) ?? '';
  const coverUri =
    normalizeMemoryMediaUriForDisplay((coverSigned || coverRaw).trim()) ||
    fallbackUri.trim() ||
    null;

  return (
    <View style={styles.thumb}>
      {coverUri ? (
        <Image
          source={{ uri: coverUri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`modal-book-cover-${book.id}-${book.coverPhotoUrl ?? ''}`}
          transition={0}
        />
      ) : (
        <View style={styles.placeholder}>
          <BookOpen size={scale(18)} color="#FFFFFF" strokeWidth={2.2} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: {
    width: scale(56),
    height: scale(56),
    borderRadius: scale(14),
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
