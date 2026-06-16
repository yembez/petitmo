import { useCallback, useEffect, useRef, useState, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Modal,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  DeviceEventEmitter,
  InteractionManager,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { BookOpen, Plus } from 'lucide-react-native';
import { useFonts, EBGaramond_400Regular_Italic } from '@expo-google-fonts/eb-garamond';
import { Inter_500Medium, Inter_700Bold } from '@expo-google-fonts/inter';
import { Swipeable } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import BookCoverThumbnail from '@/components/BookCoverThumbnail';
import { bookCoverPeriodLabelForBook } from '@/utils/bookCoverPeriodLabel';
import {
  booksListVisualSignature,
  deleteBook,
  healAllBookCovers,
  healAllBookMemoryIdsIfWiped,
  listBooks,
  listBooksFromSqliteSync,
  resolveBookListRowCoverUri,
  type Book,
} from '@/services/books';
import { feedBooksHydrationSnapshot, setFeedBooksHydrationSnapshot } from '@/services/tabScreensCache';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { normalizeMemoryMediaUriForDisplay } from '@/utils/memoryPhotos';
import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';
import TabSceneTransition from '@/components/TabSceneTransition';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const BOOK_ROW_PRESS_SPRING = { damping: 18, stiffness: 320 };

type BookListRowProps = {
  book: Book;
  coverTitleFontFamily?: string;
  listTitleFontFamily?: string;
  listMetaFontFamily?: string;
  onOpen: (bookId: string) => void;
  onDelete: (book: Book) => void;
};

function coverCropsEqual(
  a: Book['photoCrops'],
  b: Book['photoCrops'],
): boolean {
  const ca = a?.cover;
  const cb = b?.cover;
  if (!ca && !cb) return true;
  if (!ca || !cb) return false;
  return ca.xPct === cb.xPct && ca.yPct === cb.yPct && ca.scale === cb.scale;
}

function bookListRowPropsEqual(prev: BookListRowProps, next: BookListRowProps): boolean {
  if (prev.coverTitleFontFamily !== next.coverTitleFontFamily) return false;
  if (prev.listTitleFontFamily !== next.listTitleFontFamily) return false;
  if (prev.listMetaFontFamily !== next.listMetaFontFamily) return false;
  if (prev.onOpen !== next.onOpen || prev.onDelete !== next.onDelete) return false;
  const a = prev.book;
  const b = next.book;
  if (a.id !== b.id || a.title !== b.title || a.createdAt !== b.createdAt) return false;
  if ((a.coverPhotoUrl ?? '') !== (b.coverPhotoUrl ?? '')) return false;
  if (!coverCropsEqual(a.photoCrops, b.photoCrops)) return false;
  if (a.memoryIds.length !== b.memoryIds.length) return false;
  for (let i = 0; i < a.memoryIds.length; i++) {
    if (a.memoryIds[i] !== b.memoryIds[i]) return false;
  }
  return resolveBookListRowCoverUri(a) === resolveBookListRowCoverUri(b);
}

const BookListRow = memo(function BookListRow({
  book,
  coverTitleFontFamily,
  listTitleFontFamily,
  listMetaFontFamily,
  onOpen,
  onDelete,
}: BookListRowProps) {
  const pressScale = useSharedValue(1);
  const rowAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const coverRaw = resolveBookListRowCoverUri(book);
  const coverSigned = useSignedMediaUrl(coverRaw || null) ?? '';
  const coverUri = normalizeMemoryMediaUriForDisplay((coverSigned || coverRaw).trim()) || null;
  const coverCrop = book.photoCrops?.cover;
  const coverCropKey = coverCrop
    ? `${coverCrop.xPct}-${coverCrop.yPct}-${coverCrop.scale}`
    : '';
  const count = book.memoryIds.length;
  const dateLabel = bookCoverPeriodLabelForBook(book);

  return (
    <Swipeable
      renderRightActions={() => (
        <View style={styles.swipeActions}>
          <TouchableOpacity
            style={styles.swipeDeleteBtn}
            onPress={() => onDelete(book)}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={`Supprimer le livre ${book.title}`}
          >
            <Text style={styles.swipeDeleteText}>Supprimer</Text>
          </TouchableOpacity>
        </View>
      )}
      rightThreshold={scale(42)}
      overshootRight={false}
    >
      <AnimatedPressable
        style={[styles.row, rowAnimStyle]}
        onPress={() => onOpen(book.id)}
        onPressIn={() => {
          pressScale.value = withSpring(0.98, BOOK_ROW_PRESS_SPRING);
        }}
        onPressOut={() => {
          pressScale.value = withSpring(1, BOOK_ROW_PRESS_SPRING);
        }}
        accessibilityRole="button"
        accessibilityLabel={`Livre ${book.title}`}
      >
        <BookCoverThumbnail
          title={book.title}
          coverImageUri={coverUri}
          coverPhotoCrop={coverCrop}
          dateLabel={dateLabel}
          imageRecyclingKey={`book-cover-${book.id}-${book.coverPhotoUrl ?? ''}-${coverCropKey}`}
          titleFontFamily={coverTitleFontFamily}
        />
        <View style={styles.rowText}>
          <Text
            style={[
              styles.rowTitle,
              listTitleFontFamily
                ? { fontFamily: listTitleFontFamily }
                : { fontWeight: '700' },
            ]}
            numberOfLines={2}
          >
            {book.title}
          </Text>
          <Text
            style={[
              styles.rowMeta,
              listMetaFontFamily
                ? { fontFamily: listMetaFontFamily }
                : { fontWeight: '500' },
            ]}
          >
            {count === 0
              ? 'Aucun souvenir'
              : count === 1
                ? '1 souvenir'
                : `${count} souvenirs`}
          </Text>
        </View>
        <Text style={styles.chevron}>→</Text>
      </AnimatedPressable>
    </Swipeable>
  );
}, bookListRowPropsEqual);

function LivresScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [books, setBooks] = useState<Book[]>(() => [...feedBooksHydrationSnapshot]);
  const [refreshing, setRefreshing] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const booksRef = useRef(books);
  const booksSigRef = useRef(booksListVisualSignature(books));

  const [listFontsLoaded] = useFonts({
    EBGaramond_400Regular_Italic,
    Inter_500Medium,
    Inter_700Bold,
  });
  const coverTitleFontFamily = listFontsLoaded ? 'EBGaramond_400Regular_Italic' : undefined;
  const listTitleFontFamily = listFontsLoaded ? 'Inter_700Bold' : undefined;
  const listMetaFontFamily = listFontsLoaded ? 'Inter_500Medium' : undefined;

  booksRef.current = books;

  const applyBooksList = useCallback((next: Book[]) => {
    const sig = booksListVisualSignature(next);
    if (sig === booksSigRef.current) return;
    booksSigRef.current = sig;
    setBooks(next);
    setFeedBooksHydrationSnapshot(next);
  }, []);

  const load = useCallback(async (opts?: { pull?: boolean; force?: boolean }) => {
    if (opts?.pull) setRefreshing(true);
    try {
      const sync = listBooksFromSqliteSync();
      if (!opts?.force) {
        applyBooksList(sync);
      }
      const healed = await healAllBookCovers(
        await healAllBookMemoryIdsIfWiped(await listBooks()),
      );
      if (opts?.force) {
        booksSigRef.current = booksListVisualSignature(healed);
        setBooks(healed);
        setFeedBooksHydrationSnapshot(healed);
        return;
      }
      applyBooksList(healed);
    } finally {
      setRefreshing(false);
    }
  }, [applyBooksList]);

  const healBooksInBackground = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      void (async () => {
        const healed = await healAllBookCovers(
          await healAllBookMemoryIdsIfWiped(listBooksFromSqliteSync()),
        );
        applyBooksList(healed);
      })();
    });
  }, [applyBooksList]);

  useFocusEffect(
    useCallback(() => {
      /** Déjà affiché → resync SQLite ; répare les couvertures favoris en arrière-plan si besoin. */
      if (booksRef.current.length > 0) {
        applyBooksList(listBooksFromSqliteSync());
        healBooksInBackground();
        return;
      }
      const cached = feedBooksHydrationSnapshot;
      if (cached.length > 0) {
        applyBooksList(cached);
        void load();
        return;
      }
      void load();
    }, [applyBooksList, load, healBooksInBackground])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('petitmo:memories-invalidate', () => {
      void load();
    });
    return () => sub.remove();
  }, [load]);

  const onRefresh = useCallback(() => {
    void load({ pull: true, force: true });
  }, [load]);

  const openBook = useCallback(
    (bookId: string) => {
      router.push({ pathname: '/book-preview', params: { bookId } });
    },
    [router]
  );

  const confirmDelete = useCallback((b: Book) => {
    Alert.alert('Supprimer ce livre ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer',
        style: 'destructive',
        onPress: () => {
          setBooks(prev => {
            const next = prev.filter(x => x.id !== b.id);
            booksSigRef.current = booksListVisualSignature(next);
            setFeedBooksHydrationSnapshot(next);
            return next;
          });
          void deleteBook(b.id);
        },
      },
    ]);
  }, []);

  const openCreateFlow = useCallback(() => {
    setDraftTitle('');
    setCreateModalOpen(true);
  }, []);

  const renderBookRow = useCallback(
    ({ item }: { item: Book }) => (
      <BookListRow
        book={item}
        coverTitleFontFamily={coverTitleFontFamily}
        listTitleFontFamily={listTitleFontFamily}
        listMetaFontFamily={listMetaFontFamily}
        onOpen={openBook}
        onDelete={confirmDelete}
      />
    ),
    [coverTitleFontFamily, listTitleFontFamily, listMetaFontFamily, openBook, confirmDelete]
  );

  const startCreateFlowToFavoris = useCallback(() => {
    const title = draftTitle.trim();
    setCreateModalOpen(false);
    // On ne crée PAS le livre ici. On passe par Favoris pour sélectionner,
    // puis Favoris créera le livre + injectera la sélection.
    router.push({
      pathname: '/(tabs)/favoris',
      params: { createBookTitle: title || 'Nouveau livre' },
    });
  }, [draftTitle, router]);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + verticalScale(12) }]}>
        <Text
          style={[
            styles.title,
            listTitleFontFamily
              ? { fontFamily: listTitleFontFamily }
              : { fontWeight: '700' },
          ]}
        >
          Livres
        </Text>
        <TouchableOpacity
          style={styles.headerCta}
          onPress={openCreateFlow}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Créer un livre"
        >
          <Plus size={scale(20)} color="#FFFFFF" strokeWidth={2.4} />
          <Text style={styles.headerCtaText}>Nouveau</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={books}
        keyExtractor={item => item.id}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={THEME.brandCtaOrange} />
        }
        ItemSeparatorComponent={() => <View style={styles.rowSep} />}
        contentContainerStyle={[
          styles.listContent,
          books.length === 0 && styles.listContentEmpty,
          { paddingBottom: verticalScale(24) + tabBarFloatingOverlapPad(insets.bottom) },
        ]}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <View style={styles.emptyIcon}>
              <BookOpen size={scale(36)} color={THEME.textMuted} strokeWidth={2} />
            </View>
            <Text style={styles.emptyTitle}>Aucun livre pour l’instant</Text>
            <Text style={styles.emptySub}>Crée un livre pour rassembler tes souvenirs.</Text>
            <TouchableOpacity
              style={styles.emptyCta}
              onPress={openCreateFlow}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Créer un livre"
            >
              <Text style={styles.emptyCtaText}>Créer un livre</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={renderBookRow}
      />

      <Modal visible={createModalOpen} transparent animationType="fade" onRequestClose={() => setCreateModalOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[styles.modalBackdrop, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
        >
          <Pressable style={{ flex: 1 }} onPress={() => setCreateModalOpen(false)}>
            <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
              <Text style={styles.modalTitle}>Créer un nouveau livre</Text>
              <Text style={styles.modalSub}>
                Donne un titre, puis tu seras redirigé vers Favoris pour sélectionner les souvenirs à ajouter.
              </Text>
              <TextInput
                value={draftTitle}
                onChangeText={setDraftTitle}
                placeholder="Titre du livre (optionnel)"
                placeholderTextColor={THEME.textMuted}
                style={styles.modalInput}
                returnKeyType="done"
                onSubmitEditing={startCreateFlowToFavoris}
              />
              <View style={styles.modalBtns}>
                <TouchableOpacity
                  style={styles.modalBtnGhost}
                  onPress={() => setCreateModalOpen(false)}
                  activeOpacity={0.9}
                >
                  <Text style={styles.modalBtnGhostText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalBtnCta}
                  onPress={startCreateFlowToFavoris}
                  activeOpacity={0.9}
                >
                  <Text style={styles.modalBtnCtaText}>Choisir des favoris →</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

export default function LivresScreenTab() {
  return (
    <TabSceneTransition>
      <LivresScreen />
    </TabSceneTransition>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bgScreen,
  },
  modalBackdrop: {
    flex: 1,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
  },
  modalCard: {
    backgroundColor: THEME.bg,
    borderRadius: 16,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.familyFlowLine,
  },
  modalTitle: {
    color: THEME.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalSub: {
    color: THEME.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  modalInput: {
    height: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: THEME.bg,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    color: THEME.textPrimary,
    marginBottom: 12,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 10,
  },
  modalBtnGhost: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.bg,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  modalBtnGhostText: {
    color: THEME.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  modalBtnCta: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    paddingHorizontal: scale(12),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.brandArdoise,
  },
  modalBtnCtaText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(20),
    paddingBottom: verticalScale(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
    backgroundColor: THEME.bg,
  },
  title: {
    fontSize: scale(26),
    color: THEME.textPrimary,
    letterSpacing: scale(-0.4),
  },
  headerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(6),
    backgroundColor: THEME.brandArdoise,
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(16),
    borderRadius: scale(999),
  },
  headerCtaText: {
    color: '#FFFFFF',
    fontSize: scale(14),
    fontWeight: '800',
  },
  listContent: {
    paddingTop: verticalScale(16),
    paddingHorizontal: scale(20),
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  rowSep: {
    height: verticalScale(10),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: THEME.bg,
    borderRadius: scale(14),
    padding: scale(14),
    paddingLeft: scale(12),
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    gap: scale(14),
  },
  swipeActions: {
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  swipeDeleteBtn: {
    height: '100%',
    justifyContent: 'center',
    backgroundColor: '#E23B3B',
    paddingHorizontal: scale(18),
    borderRadius: 0,
  },
  swipeDeleteText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: scale(14),
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: scale(16),
    color: THEME.textPrimary,
  },
  rowMeta: {
    marginTop: verticalScale(4),
    fontSize: scale(13),
    color: THEME.textMuted,
  },
  chevron: {
    marginLeft: scale(8),
    fontSize: scale(18),
    color: THEME.textMuted,
    fontWeight: '700',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: verticalScale(48),
    paddingHorizontal: scale(24),
  },
  emptyIcon: {
    marginBottom: verticalScale(16),
  },
  emptyTitle: {
    fontSize: scale(18),
    fontWeight: '800',
    color: THEME.textPrimary,
    textAlign: 'center',
  },
  emptySub: {
    marginTop: verticalScale(8),
    fontSize: scale(14),
    color: THEME.textMuted,
    textAlign: 'center',
    lineHeight: scale(20),
  },
  emptyCta: {
    marginTop: verticalScale(24),
    backgroundColor: THEME.brandArdoise,
    paddingVertical: verticalScale(14),
    paddingHorizontal: scale(28),
    borderRadius: scale(999),
  },
  emptyCtaText: {
    color: '#FFFFFF',
    fontSize: scale(15),
    fontWeight: '800',
  },
});
