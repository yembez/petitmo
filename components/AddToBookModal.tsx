import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, Plus, X } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import type { Book, BookPageEntry } from '@/services/books';
import {
  addMemoriesToBook,
  bookHasPageEntry,
  createBookWithMemories,
  dedupeMemoryIds,
  listBooks,
  removeMemoriesFromBook,
  upsertBook,
} from '@/services/books';
import { getLocalMemoryById } from '@/lib/localDb';
import { canonicalBookCoverPhotoRef } from '@/utils/memoryPhotos';
import { THEME } from '@/constants/theme';
import { ModalBookCoverThumb } from '@/components/ModalBookCoverThumb';

const INK = '#1C1C1E';

export type AddToBookModalProps = {
  visible: boolean;
  onClose: () => void;
  /** Ids de souvenirs à ajouter ou retirer (distincts). */
  memoryIds: string[];
  /** Slot photo album par souvenir (depuis sélection Favoris). */
  memoryPhotoRefs?: Record<string, string>;
  /** Pages précises à APPEND (même memoryId + autre photo = nouvelle page). */
  pageEntries?: BookPageEntry[];
  /** Fallback vignette livre (ex. photo profil enfant) si pas de coverPhotoUrl. */
  coverFallbackUrl?: string;
  /**
   * Si `true`, après un ajout on redirige vers l'onglet Livres.
   * Par défaut: `true` (comportement historique). Depuis Favoris: passer `false`.
   */
  redirectToBooksOnDone?: boolean;
};

export function AddToBookModal({
  visible,
  onClose,
  memoryIds,
  memoryPhotoRefs,
  pageEntries,
  coverFallbackUrl = '',
  redirectToBooksOnDone = true,
}: AddToBookModalProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const newBookInputRef = useRef<TextInput | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [createBookMode, setCreateBookMode] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState('');
  const [addedBookIds, setAddedBookIds] = useState<string[]>([]);
  const [didAdd, setDidAdd] = useState(false);

  const refreshBooks = useCallback(async () => {
    const b = await listBooks();
    setBooks(b);
  }, []);

  useEffect(() => {
    if (!visible) return;
    setCreateBookMode(false);
    setNewBookTitle('');
    setAddedBookIds([]);
    setDidAdd(false);
    setBooksLoading(true);
    void (async () => {
      try {
        await refreshBooks();
      } finally {
        setBooksLoading(false);
      }
    })();
  }, [visible, refreshBooks]);

  const closeModal = useCallback(() => {
    onClose();
    setCreateBookMode(false);
  }, [onClose]);

  const closeModalToBooks = useCallback(() => {
    closeModal();
    if (didAdd && redirectToBooksOnDone) {
      router.replace('/(tabs)/livres');
    }
  }, [closeModal, didAdd, redirectToBooksOnDone, router]);

  /** Ids distincts : le check vert ne s’affiche que si chacun est déjà dans le livre (pas de cas partiel). */
  const selectionMemoryIds = useMemo(() => dedupeMemoryIds(memoryIds), [memoryIds]);

  const allSelectionAlreadyInBook = useCallback(
    (b: Book) => {
      if (pageEntries && pageEntries.length > 0) {
        return pageEntries.every(e => bookHasPageEntry(b, e));
      }
      if (selectionMemoryIds.length === 0) return false;
      const inBook = new Set(b.memoryIds);
      return selectionMemoryIds.every(id => inBook.has(id));
    },
    [pageEntries, selectionMemoryIds]
  );

  const addAllToBook = useCallback(
    async (bookId: string) => {
      const b = (await listBooks()).find(x => x.id === bookId);
      if (!b) return;
      try {
        if (pageEntries && pageEntries.length > 0) {
          const updated = await addMemoriesToBook(
            bookId,
            pageEntries.map(e => e.memoryId),
            { pageEntries },
          );
          if (!updated) return;
        } else {
          const toAdd = selectionMemoryIds.filter(id => !b.memoryIds.includes(id));
          if (toAdd.length === 0 && !memoryPhotoRefs) {
            await refreshBooks();
            setAddedBookIds(prev => (prev.includes(bookId) ? prev : [...prev, bookId]));
            setDidAdd(true);
            return;
          }
          await addMemoriesToBook(bookId, toAdd, { memoryPhotoRefs });
        }
      } catch (e) {
        Alert.alert('Petit Cœur', e instanceof Error ? e.message : "Impossible d'ajouter à ce livre.");
        return;
      }
      await refreshBooks();
      setAddedBookIds(prev => (prev.includes(bookId) ? prev : [...prev, bookId]));
      setDidAdd(true);
    },
    [memoryPhotoRefs, pageEntries, selectionMemoryIds, refreshBooks]
  );

  const removeAllFromBook = useCallback(
    async (bookId: string) => {
      await removeMemoriesFromBook(bookId, selectionMemoryIds);
      await refreshBooks();
    },
    [selectionMemoryIds, refreshBooks]
  );

  const startCreateBook = useCallback(() => {
    setNewBookTitle('');
    setCreateBookMode(true);
    requestAnimationFrame(() => {
      setTimeout(() => newBookInputRef.current?.focus(), 60);
    });
  }, []);

  const createAndAddToNewBook = useCallback(async () => {
    let created: Book;
    try {
      created = await createBookWithMemories(newBookTitle, selectionMemoryIds, {
        pageEntries,
        memoryPhotoRefs,
      });
    } catch (e) {
      Alert.alert('Petit Cœur', e instanceof Error ? e.message : "Impossible d'ajouter à ce livre.");
      return;
    }
    const updated = created;
    // Couverture par défaut: première photo sélectionnée (source, jamais un thumb).
    for (const id of selectionMemoryIds) {
      const m = getLocalMemoryById(id);
      if (!m || m.type !== 'photo') continue;
      const src = canonicalBookCoverPhotoRef(m).trim();
      if (src) {
        await upsertBook({ ...updated, coverPhotoUrl: src });
      }
      break;
    }
    await refreshBooks();
    setCreateBookMode(false);
    setAddedBookIds([created.id]);
    setDidAdd(true);
  }, [memoryPhotoRefs, newBookTitle, pageEntries, refreshBooks, selectionMemoryIds]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={closeModalToBooks}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[
          styles.modalBackdrop,
          { paddingTop: insets.top + scale(16), paddingBottom: insets.bottom + scale(16) },
        ]}
        keyboardVerticalOffset={0}
      >
        <Pressable style={{ flex: 1 }} onPress={closeModalToBooks}>
          <Pressable style={styles.modalCard} onPress={e => e.stopPropagation()}>
            <View style={styles.modalCardInner}>
              <View style={styles.modalHeaderRow}>
                <View style={styles.modalHeaderTitles}>
                  <Text style={styles.modalTitle}>Ajouter à un livre</Text>
                  <Text style={styles.modalSub}>Choisis un livre existant ou crée-en un nouveau.</Text>
                </View>
                <Pressable
                  onPress={closeModalToBooks}
                  hitSlop={12}
                  style={({ pressed }) => [styles.modalCloseBtn, pressed && { opacity: 0.65 }]}
                  accessibilityRole="button"
                  accessibilityLabel="Fermer"
                >
                  <X size={scale(22)} color="#1C1C1E" strokeWidth={2.2} />
                </Pressable>
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalScrollContent}
              >
                {createBookMode ? (
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Créer un livre</Text>
                    <TextInput
                      ref={r => {
                        newBookInputRef.current = r;
                      }}
                      value={newBookTitle}
                      onChangeText={setNewBookTitle}
                      placeholder="Nom du livre (optionnel)"
                      placeholderTextColor="rgba(28,28,30,0.35)"
                      style={styles.modalInput}
                      returnKeyType="done"
                      onSubmitEditing={() => void createAndAddToNewBook()}
                    />

                    <View style={styles.modalCreateRow}>
                      <TouchableOpacity
                        style={styles.modalCreateCancel}
                        activeOpacity={0.85}
                        onPress={() => setCreateBookMode(false)}
                        accessibilityRole="button"
                        accessibilityLabel="Annuler"
                      >
                        <Text style={styles.modalCreateCancelText}>Annuler</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.modalCreateCta}
                        activeOpacity={0.9}
                        onPress={() => void createAndAddToNewBook()}
                        accessibilityRole="button"
                        accessibilityLabel="Créer le livre"
                      >
                        <Text style={styles.modalCreateCtaText}>Créer le livre</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Livres</Text>
                    {booksLoading ? (
                      <View style={{ paddingVertical: 10 }}>
                        <ActivityIndicator />
                      </View>
                    ) : books.length === 0 ? (
                      <View style={styles.modalBookList}>
                        <Text style={styles.modalEmpty}>
                          Aucun livre pour le moment. Crée-en un pour y ajouter ta sélection.
                        </Text>
                        <TouchableOpacity
                          style={[styles.modalBookRow, styles.modalBookRowNew]}
                          activeOpacity={0.9}
                          onPress={startCreateBook}
                          accessibilityRole="button"
                          accessibilityLabel="Créer un livre"
                        >
                          <View style={[styles.modalThumb, styles.modalThumbNew]}>
                            <Plus size={scale(18)} color={INK} strokeWidth={2.6} />
                          </View>
                          <Text style={styles.modalBookTitle} numberOfLines={1}>
                            Créer un livre
                          </Text>
                          <Text style={styles.modalBookMeta} numberOfLines={1}>
                            +
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View style={styles.modalBookList}>
                        <TouchableOpacity
                          style={[styles.modalBookRow, styles.modalBookRowNew]}
                          activeOpacity={0.9}
                          onPress={startCreateBook}
                          accessibilityRole="button"
                          accessibilityLabel="Créer un livre"
                        >
                          <View style={[styles.modalThumb, styles.modalThumbNew]}>
                            <Plus size={scale(18)} color={INK} strokeWidth={2.6} />
                          </View>
                          <Text style={styles.modalBookTitle} numberOfLines={1}>
                            Créer un livre
                          </Text>
                          <Text style={styles.modalBookMeta} numberOfLines={1}>
                            +
                          </Text>
                        </TouchableOpacity>
                        {books.map(b => {
                          const justAdded = addedBookIds.includes(b.id);
                          const has = allSelectionAlreadyInBook(b);
                          return (
                            <View key={b.id} style={[styles.modalBookRow, (has || justAdded) && styles.modalBookRowActive]}>
                              <Pressable
                                onPress={() => {
                                  closeModal();
                                  router.push({ pathname: '/book-preview', params: { bookId: b.id } });
                                }}
                                style={({ pressed }) => [styles.modalThumbWrap, pressed && { opacity: 0.92 }]}
                                accessibilityRole="button"
                                accessibilityLabel={`Éditer le livre ${b.title}`}
                              >
                                <ModalBookCoverThumb book={b} fallbackUri={coverFallbackUrl} />
                                {has ? (
                                  <View style={styles.modalThumbCheck} pointerEvents="none">
                                    <Check size={scale(14)} color="#FFFFFF" strokeWidth={3.2} />
                                  </View>
                                ) : null}
                              </Pressable>
                              <Text style={styles.modalBookTitle} numberOfLines={1}>
                                {b.title}
                              </Text>
                                {justAdded ? (
                                  <View style={styles.modalBookAddedBtn} pointerEvents="none">
                                    <Text style={styles.modalBookAddedBtnText}>Ajouté</Text>
                                  </View>
                                ) : has ? (
                                <TouchableOpacity
                                  style={styles.modalBookRemoveBtn}
                                  activeOpacity={0.9}
                                  onPress={() => void removeAllFromBook(b.id)}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Retirer du livre ${b.title}`}
                                >
                                  <Text style={styles.modalBookRemoveBtnText}>Retirer</Text>
                                </TouchableOpacity>
                              ) : (
                                <TouchableOpacity
                                    style={styles.modalBookAddBtn}
                                  activeOpacity={0.9}
                                  onPress={() => void addAllToBook(b.id)}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Ajouter au livre ${b.title}`}
                                >
                                  <Text style={styles.modalBookAddBtnText}>Ajouter</Text>
                                </TouchableOpacity>
                              )}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </ScrollView>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={styles.modalOkBtn}
                  activeOpacity={0.9}
                  onPress={closeModalToBooks}
                  accessibilityRole="button"
                  accessibilityLabel="OK"
                >
                  <Text style={styles.modalOkBtnText}>OK</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: scale(16),
  },
  modalCard: {
    backgroundColor: THEME.bg,
    borderRadius: scale(16),
    padding: scale(18),
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalCardInner: {
    flexGrow: 1,
  },
  modalFooter: {
    marginTop: verticalScale(12),
    paddingTop: verticalScale(14),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.10)',
  },
  modalOkBtn: {
    backgroundColor: THEME.brandArdoise,
    borderRadius: scale(999),
    paddingVertical: verticalScale(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOkBtnText: {
    color: '#FFFFFF',
    fontSize: scale(15),
    fontWeight: '800',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: scale(10),
  },
  modalHeaderTitles: {
    flex: 1,
    minWidth: 0,
  },
  modalCloseBtn: {
    marginTop: verticalScale(2),
    padding: scale(6),
    borderRadius: scale(999),
  },
  modalScrollContent: {
    paddingBottom: verticalScale(8),
  },
  modalTitle: {
    fontSize: scale(18),
    fontWeight: '800',
    color: '#1C1C1E',
  },
  modalSub: {
    marginTop: verticalScale(6),
    fontSize: scale(13),
    color: '#6B7280',
    lineHeight: scale(18),
  },
  modalSection: { marginTop: verticalScale(16) },
  modalSectionTitle: {
    fontSize: scale(13),
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: verticalScale(8),
  },
  modalEmpty: { fontSize: scale(13), color: '#6B7280' },
  modalBookList: { gap: verticalScale(8) },
  modalBookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    borderRadius: scale(12),
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(16),
  },
  modalBookRowNew: {
    borderStyle: 'dashed',
    borderColor: 'rgba(0,0,0,0.16)',
    backgroundColor: '#F9FAFB',
  },
  modalBookRowActive: {
    borderColor: '#D1D5DB',
    backgroundColor: '#E5E7EB',
  },
  modalThumb: {
    width: scale(56),
    height: scale(56),
    borderRadius: scale(14),
    overflow: 'hidden',
    backgroundColor: '#111827',
  },
  modalThumbWrap: {
    position: 'relative',
    width: scale(56),
    height: scale(56),
    marginRight: scale(12),
  },
  modalThumbNew: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalThumbCheck: {
    position: 'absolute',
    right: scale(-6),
    top: scale(-6),
    width: scale(22),
    height: scale(22),
    borderRadius: scale(11),
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  modalBookTitle: { flex: 1, minWidth: 0, fontSize: scale(15), fontWeight: '800', color: '#1C1C1E' },
  modalBookMeta: { marginLeft: scale(12), fontSize: scale(13), fontWeight: '700', color: '#6B7280' },
  modalBookAddBtn: {
    marginLeft: scale(12),
    backgroundColor: THEME.brandArdoise,
    borderRadius: scale(999),
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(16),
  },
  modalBookAddBtnText: {
    fontSize: scale(13),
    fontWeight: '800',
    color: '#FFFFFF',
  },
  modalBookRemoveBtn: {
    marginLeft: scale(12),
    borderWidth: 1.5,
    borderColor: 'rgba(107, 114, 128, 0.45)',
    borderRadius: scale(999),
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(16),
    backgroundColor: '#FFFFFF',
  },
  modalBookRemoveBtnText: {
    fontSize: scale(13),
    fontWeight: '800',
    color: '#6B7280',
  },
  modalBookAddedBtn: {
    marginLeft: scale(12),
    backgroundColor: '#16A34A',
    borderRadius: scale(999),
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(16),
  },
  modalBookAddedBtnText: {
    fontSize: scale(13),
    fontWeight: '900',
    color: '#FFFFFF',
  },
  modalCreateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: verticalScale(12),
    gap: scale(10),
  },
  modalCreateCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    borderRadius: scale(999),
    paddingVertical: verticalScale(12),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  modalCreateCancelText: {
    fontSize: scale(14),
    fontWeight: '800',
    color: '#111827',
  },
  modalCreateCta: {
    flex: 1,
    backgroundColor: THEME.brandArdoise,
    borderRadius: scale(999),
    paddingVertical: verticalScale(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCreateCtaText: {
    color: '#FFFFFF',
    fontSize: scale(14),
    fontWeight: '800',
  },
  modalInput: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    borderRadius: scale(12),
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(10),
    fontSize: scale(15),
    color: '#1C1C1E',
  },
});
