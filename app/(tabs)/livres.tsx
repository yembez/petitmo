import { useCallback, useEffect, useState, memo } from 'react';
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
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { BookOpen, Plus } from 'lucide-react-native';
import { Swipeable } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import BookCoverThumbnail from '@/components/BookCoverThumbnail';
import { bookCoverPeriodLabelForBook } from '@/utils/bookCoverPeriodLabel';
import { normalizeMemoryMediaUriForDisplay } from '@/utils/memoryPhotos';
import type { Book } from '@/services/books';
import { deleteBook, listBooks, resolveBookListCoverDisplayUri } from '@/services/books';
import { feedBooksHydrationSnapshot } from '@/services/tabScreensCache';
import { supabase } from '@/lib/supabase';
import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const BOOK_ROW_PRESS_SPRING = { damping: 18, stiffness: 320 };

type BookListRowProps = {
  book: Book;
  authToken: string | null;
  onOpen: (bookId: string) => void;
  onDelete: (book: Book) => void;
};

const BookListRow = memo(function BookListRow({ book, authToken, onOpen, onDelete }: BookListRowProps) {
  const pressScale = useSharedValue(1);
  const rowAnimStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const uri = resolveBookListCoverDisplayUri(book);
  const count = book.memoryIds.length;
  const needsAuthHeader = !!uri && /^https?:\/\//i.test(uri) && uri.includes('supabase');
  const imageHeaders =
    needsAuthHeader && authToken ? { Authorization: `Bearer ${authToken}` } : undefined;
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
          coverImageUri={uri}
          dateLabel={dateLabel}
          imageHeaders={imageHeaders}
        />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {book.title}
          </Text>
          <Text style={styles.rowMeta}>
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
});

export default function LivresScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [books, setBooks] = useState<Book[]>(() => [...feedBooksHydrationSnapshot]);
  const [refreshing, setRefreshing] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void (async () => {
        try {
          const { data } = await supabase.auth.getSession();
          const t = data.session?.access_token ?? null;
          if (alive) setAuthToken(t);
        } catch {
          if (alive) setAuthToken(null);
        }
      })();
      return () => {
        alive = false;
      };
    }, [])
  );

  const load = useCallback(async (opts?: { pull?: boolean }) => {
    if (opts?.pull) setRefreshing(true);
    try {
      const bks = await listBooks();
      setBooks(bks);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('petitmo:memories-invalidate', () => {
      void load();
    });
    return () => sub.remove();
  }, [load]);

  const onRefresh = useCallback(() => {
    void load({ pull: true });
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
          setBooks(prev => prev.filter(x => x.id !== b.id));
          void deleteBook(b.id);
        },
      },
    ]);
  }, []);

  const openCreateFlow = useCallback(() => {
    setDraftTitle('');
    setCreateModalOpen(true);
  }, []);

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
        <Text style={styles.title}>Livres</Text>
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={THEME.brandPrimary} />
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
        renderItem={({ item }) => (
          <BookListRow
            book={item}
            authToken={authToken}
            onOpen={openBook}
            onDelete={confirmDelete}
          />
        )}
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
    fontWeight: '800',
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
    fontWeight: '800',
    color: THEME.textPrimary,
  },
  rowMeta: {
    marginTop: verticalScale(4),
    fontSize: scale(13),
    fontWeight: '600',
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
