import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  Pressable,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookOpen, Check, ChevronLeft, Pencil, Plus, X } from 'lucide-react-native';
import { useFonts, Lora_400Regular_Italic } from '@expo-google-fonts/lora';
import { Video, ResizeMode } from 'expo-av';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import { MEDIA_CARD_INSET, MEDIA_CARD_RADIUS } from '@/constants/feedLayout';
import PhotoMosaic from '@/components/PhotoMosaic';
import AudioPlayer from '@/components/AudioPlayer';
import EditTextModal from '@/components/EditTextModal';
import { getMemoryById, updateMemoryContent } from '@/services/media';
import { resolveChildProfileImageUri } from '@/utils/childPhotoUri';
import { getChildren } from '@/services/children';
import { getAllPhotoUrlsForDisplay, parseFavoritePhotoUrls } from '@/utils/memoryPhotos';
import { getSignedMediaDisplayUrl, useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import {
  formatDateLong,
  formatDuration,
  formatAgeAtMemory,
  formatBookLocationShort,
} from '@/utils/date';
import { addMemoryToBook, createBook, listBooks, removeMemoryFromBook, type Book } from '@/services/books';
import type { Child, Memory } from '@/types/local';

const INK = THEME.textPrimary;
const FEED_GUTTER = scale(20);
const TEXT_POST_GUTTER = scale(32);
const POST_BORDER_SUBTLE = 'rgba(0,0,0,0.08)';
const FONT_MAMAN = 'Lora_400Regular_Italic';
const EM_QUAD = '\u2003';
const DOCK_BG = '#FFFFFF';

export default function MemoryViewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const rawId = useLocalSearchParams<{ memoryId?: string | string[] }>().memoryId;
  const memoryId = Array.isArray(rawId) ? rawId[0] : rawId;

  const newBookInputRef = useRef<TextInput | null>(null);

  const [fontsLoaded] = useFonts({ Lora_400Regular_Italic });
  const [memory, setMemory] = useState<Memory | null>(null);
  const [child, setChild] = useState<Child | null>(null);
  const [loading, setLoading] = useState(true);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);
  const [books, setBooks] = useState<Book[]>([]);
  const [bookModalVisible, setBookModalVisible] = useState(false);
  const [createBookMode, setCreateBookMode] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState('');
  const [booksLoading, setBooksLoading] = useState(false);
  const [dockH, setDockH] = useState(0);

  const load = useCallback(async () => {
    if (!memoryId) {
      setMemory(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const m = await getMemoryById(memoryId);
    setMemory(m);
    setIsPlayingVideo(false);
    if (m) {
      const [children, b] = await Promise.all([getChildren(), listBooks()]);
      setChild(children.find(c => c.id === m.child_id) ?? null);
      setBooks(b);
    } else {
      setChild(null);
    }
    setLoading(false);
  }, [memoryId]);

  useEffect(() => {
    load();
  }, [load]);

  const openBookModal = useCallback(() => {
    if (!memoryId) return;
    setNewBookTitle('');
    setCreateBookMode(false);
    setBookModalVisible(true);
    setBooksLoading(true);
    void (async () => {
      try {
        const b = await listBooks();
        setBooks(b);
      } finally {
        setBooksLoading(false);
      }
    })();
  }, [memoryId]);

  const closeBookModal = useCallback(() => {
    setBookModalVisible(false);
    setCreateBookMode(false);
  }, []);

  const startCreateBook = useCallback(() => {
    setNewBookTitle('');
    setCreateBookMode(true);
    requestAnimationFrame(() => {
      setTimeout(() => newBookInputRef.current?.focus(), 60);
    });
  }, []);

  const addMemoryToBookFromModal = useCallback(
    async (bookId: string) => {
      if (!memoryId) return;
      const b = books.find(x => x.id === bookId);
      if (!b) return;
      if (b.memoryIds.includes(memoryId)) return;
      let next: Awaited<ReturnType<typeof addMemoryToBook>> = null;
      try {
        next = await addMemoryToBook(bookId, memoryId);
      } catch (e) {
        Alert.alert('Petitmo', e instanceof Error ? e.message : "Impossible d'ajouter à ce livre.");
        return;
      }
      if (!next) return;
      setBooks(prev => prev.map(x => (x.id === bookId ? next : x)));
      closeBookModal();
    },
    [books, closeBookModal, memoryId]
  );

  const removeMemoryFromBookFromModal = useCallback(
    async (bookId: string) => {
      if (!memoryId) return;
      const b = books.find(x => x.id === bookId);
      if (!b?.memoryIds.includes(memoryId)) return;
      const next = await removeMemoryFromBook(bookId, memoryId);
      if (!next) return;
      setBooks(prev => prev.map(x => (x.id === bookId ? next : x)));
    },
    [books, memoryId]
  );

  const createAndAddToNewBook = useCallback(async () => {
    if (!memoryId) return;
    const created = await createBook(newBookTitle);
    let updated: Awaited<ReturnType<typeof addMemoryToBook>> = null;
    try {
      updated = await addMemoryToBook(created.id, memoryId);
    } catch (e) {
      Alert.alert('Petitmo', e instanceof Error ? e.message : "Impossible d'ajouter à ce livre.");
      return;
    }
    setBooks(prev => [updated ?? created, ...prev]);
    closeBookModal();
  }, [closeBookModal, memoryId, newBookTitle]);

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('dark');
    }, [])
  );

  const handleSaveEdit = async (text: string) => {
    if (!memory) return;
    setMemory({ ...memory, content: text });
    const ok = await updateMemoryContent(memory.id, text);
    if (!ok) {
      Alert.alert(
        'Connexion',
        "Ton texte est bien enregistré sur l’app, mais la synchronisation a échoué. Réessaie plus tard."
      );
    }
  };

  const signedChildRemote = useSignedMediaUrl(child?.photo_url ?? null);
  const voiceCoverDetailUri =
    useSignedMediaUrl(
      memory?.type === 'voice' ? ((memory.voice_cover_path ?? memory.voice_cover_url) ?? null) : null
    ) ?? '';

  const contentText = memory?.content?.trim() || '';
  const rawMediaUri = memory ? (memory.edited_media_url || memory.media_url || '').trim() : '';
  const rawVideoPoster =
    (memory?.poster_url?.trim() || memory?.thumbnail_url?.trim() || '') || '';
  const rawPhotoUrls = memory?.type === 'photo' ? getAllPhotoUrlsForDisplay(memory) : [];

  const [displayMediaUri, setDisplayMediaUri] = useState(rawMediaUri);
  const [displayVideoPoster, setDisplayVideoPoster] = useState(rawVideoPoster);
  const [displayPhotoUrls, setDisplayPhotoUrls] = useState<string[]>(rawPhotoUrls);

  useEffect(() => {
    const rawMu = memory ? (memory.edited_media_url || memory.media_url || '').trim() : '';
    const rawVp =
      (memory?.poster_url?.trim() || memory?.thumbnail_url?.trim() || '') || '';
    const rawPh = memory?.type === 'photo' ? getAllPhotoUrlsForDisplay(memory) : [];
    setDisplayMediaUri(rawMu);
    setDisplayVideoPoster(rawVp);
    setDisplayPhotoUrls(rawPh);
    if (!memory) return;

    let alive = true;
    const signIfHttp = async (u: string) => {
      const t = u.trim();
      if (!t || !/^https?:\/\//i.test(t)) return t;
      return getSignedMediaDisplayUrl(t);
    };
    void (async () => {
      const [mu, vp, ...rest] = await Promise.all([
        signIfHttp(rawMu),
        signIfHttp(rawVp),
        ...rawPh.map(signIfHttp),
      ]);
      if (!alive) return;
      setDisplayMediaUri(mu);
      setDisplayVideoPoster(vp);
      setDisplayPhotoUrls(rest);
    })();
    return () => {
      alive = false;
    };
  }, [memory]);

  const mediaUri = displayMediaUri;
  const videoPosterUri = displayVideoPoster;
  const photoUrls = displayPhotoUrls;
  const ageAtMemory = memory ? formatAgeAtMemory(child?.birthdate, memory.created_at) : '';
  const locationLineShort = memory ? formatBookLocationShort(memory.location) : '';
  const locationMeta = locationLineShort ? `à ${locationLineShort}` : '';

  const coverUriForBook = useCallback(
    (b: Book): string | null => {
      const direct = typeof b.coverPhotoUrl === 'string' ? b.coverPhotoUrl.trim() : '';
      if (direct) return direct;
      if (!child) return null;
      return resolveChildProfileImageUri(child.local_photo_path, signedChildRemote ?? child.photo_url);
    },
    [child, signedChildRemote]
  );

  const bookParagraphs = (() => {
    if (!memory || memory.type !== 'text') return [] as string[];
    const raw = (memory.content ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
    if (!raw) return ['Un joli mot du cœur'];
    const parts = raw.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : ['Un joli mot du cœur'];
  })();

  // L’annotation est accessible via le texte/placeholder directement.

  if (!memoryId) {
    return (
      <View style={[styles.root, styles.centered]}>
        <StatusBar style="dark" />
        <Text style={styles.errText}>Souvenir introuvable</Text>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.root, styles.centered]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={THEME.accent} />
      </View>
    );
  }

  if (!memory) {
    return (
      <View style={[styles.root, styles.centered]}>
        <StatusBar style="dark" />
        <Text style={styles.errText}>Ce souvenir n’existe plus.</Text>
        <Pressable style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      <View style={[styles.header, { paddingTop: insets.top + verticalScale(8) }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Retour"
        >
          <ChevronLeft size={scale(28)} color={INK} strokeWidth={2.2} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Souvenir
        </Text>
        <View style={styles.headerBtnRight} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 0) + verticalScale(24) + dockH },
        ]}
        showsVerticalScrollIndicator
      >
        <View style={styles.metaLine}>
          <Text style={styles.metaText}>
            <Text style={styles.metaBold}>{formatDateLong(memory.created_at)}</Text>
            {ageAtMemory ? (
              <>
                <Text style={styles.metaSep}> · </Text>
                <Text style={styles.metaLight}>{ageAtMemory}</Text>
              </>
            ) : null}
            {locationMeta ? (
              <>
                <Text style={styles.metaSep}> · </Text>
                <Text style={styles.metaLight}>{locationMeta}</Text>
              </>
            ) : null}
          </Text>
        </View>

        <View style={styles.postMain}>
          <View style={styles.postBody}>
            {memory.type === 'photo' && photoUrls.length > 0 && (
              <PhotoMosaic
                urls={photoUrls}
                memoryId={memory.id}
                favoritePhotoUrls={parseFavoritePhotoUrls(memory)}
                onFavoritePhotoUrlsUpdated={urls =>
                  setMemory(m => (m ? { ...m, favorite_photo_urls: urls } : m))
                }
                memoryForFavoriteVariants={memory}
              />
            )}

            {memory.type === 'video' && (!!mediaUri || !!videoPosterUri) && (
              <View style={[styles.mediaCard, styles.videoBody]}>
                {isPlayingVideo && !!mediaUri ? (
                  <Video
                    source={{ uri: mediaUri }}
                    style={{ width: '100%', height: '100%' }}
                    useNativeControls
                    resizeMode={ResizeMode.CONTAIN}
                    shouldPlay
                  />
                ) : videoPosterUri ? (
                  <Image
                    source={{ uri: videoPosterUri }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{ width: '100%', height: '100%', backgroundColor: '#ECECEF' }} />
                )}
                {!!mediaUri ? (
                  <Pressable
                    onPress={() => setIsPlayingVideo(p => !p)}
                    style={StyleSheet.absoluteFillObject}
                    accessibilityRole="button"
                    accessibilityLabel={isPlayingVideo ? 'Mettre en pause' : 'Lire la vidéo'}
                  />
                ) : null}
                {memory.duration ? (
                  <View style={styles.durationBadge} pointerEvents="none">
                    <Text style={styles.durationText}>{formatDuration(memory.duration)}</Text>
                  </View>
                ) : null}
              </View>
            )}

            {memory.type === 'voice' && (!!memory.media_url || !!mediaUri) && (
              <View
                style={[
                  styles.audioBody,
                  (memory.voice_cover_path ?? memory.voice_cover_url) ? styles.audioBodyWithCover : null,
                ]}
              >
                {!!(memory.voice_cover_path ?? memory.voice_cover_url) && (
                  <>
                    <Image
                      source={{ uri: voiceCoverDetailUri }}
                      style={styles.voiceCoverBg}
                      resizeMode="cover"
                    />
                    <View style={styles.voiceCoverScrim} />
                  </>
                )}
                <View
                  style={[
                    styles.audioForeground,
                    (memory.voice_cover_path ?? memory.voice_cover_url) ? styles.audioForegroundCover : null,
                  ]}
                >
                  <View
                    style={[
                      styles.audioPlayerWrap,
                      (memory.voice_cover_path ?? memory.voice_cover_url) ? styles.audioPlayerWrapCover : null,
                    ]}
                  >
                    <AudioPlayer
                      uri={mediaUri || (memory.media_url ?? '')}
                      duration={memory.duration || 0}
                      playbackStartSec={memory.voice_playback_start_sec ?? null}
                      variant={(memory.voice_cover_path ?? memory.voice_cover_url) ? 'coverBottom' : 'default'}
                    />
                  </View>
                </View>
              </View>
            )}

            {memory.type === 'text' && (
              <Pressable
                onPress={() => setEditModalVisible(true)}
                style={({ pressed }) => [pressed && { opacity: 0.92 }]}
                accessibilityRole="button"
                accessibilityLabel="Modifier le texte"
              >
                <View style={styles.textBody}>
                  {bookParagraphs.map((para, idx) => (
                    <Text
                      key={idx}
                      style={[
                        styles.textContent,
                        idx > 0 && styles.textBookParagraphSpacing,
                        fontsLoaded && { fontFamily: FONT_MAMAN },
                      ]}
                      {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                    >
                      {EM_QUAD}
                      {para.replace(/\n/g, `\n${EM_QUAD}`)}
                    </Text>
                  ))}
                </View>
              </Pressable>
            )}
          </View>

          {memory.type !== 'text' && (
            <Pressable
              style={styles.postCaption}
              onPress={() => setEditModalVisible(true)}
              accessibilityRole="button"
              accessibilityLabel={contentText ? 'Modifier l’annotation' : 'Ajouter une annotation'}
            >
              <View style={styles.captionRow} pointerEvents="none">
                <Pencil size={scale(16)} color="rgba(28, 28, 30, 0.62)" strokeWidth={2.2} />
                <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                style={[
                  styles.captionAnnotation,
                  !contentText && styles.captionPlaceholder,
                  fontsLoaded && { fontFamily: FONT_MAMAN },
                ]}
              >
                {contentText || 'Ajouter une annotation…'}
              </Text>
                </View>
              </View>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {memory ? (
        <View
          style={[styles.bottomDock, { paddingBottom: Math.max(insets.bottom, 0) + verticalScale(10) }]}
          onLayout={(e) => setDockH(Math.ceil(e.nativeEvent.layout.height))}
        >
          <View style={styles.dockCtaWrap}>
            <Pressable
              onPress={openBookModal}
              style={({ pressed }) => [styles.dockBookCta, pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel="Ajouter à un livre"
            >
              <BookOpen size={scale(18)} color="#FFFFFF" strokeWidth={2.2} />
              <Text style={styles.dockBookCtaText} numberOfLines={1}>
                Ajouter à un livre
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <EditTextModal
        key={memory.id}
        visible={editModalVisible}
        initialText={memory.content?.trim() ?? ''}
        title={
          memory.type === 'text'
            ? 'Modifier le texte'
            : contentText
              ? 'Modifier l’annotation'
              : 'Annoter'
        }
        onClose={() => setEditModalVisible(false)}
        onSave={handleSaveEdit}
      />

      <Modal
        visible={bookModalVisible}
        transparent
        animationType="fade"
        onRequestClose={closeBookModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={[
            styles.modalBackdrop,
            { paddingTop: insets.top + scale(16), paddingBottom: insets.bottom + scale(16) },
          ]}
          keyboardVerticalOffset={0}
        >
          <Pressable style={{ flex: 1 }} onPress={closeBookModal}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalCardInner}>
                <View style={styles.modalHeaderRow}>
                  <View style={styles.modalHeaderTitles}>
                    <Text style={styles.modalTitle}>Ajouter à un livre</Text>
                    <Text style={styles.modalSub}>Choisis un livre existant ou crée-en un nouveau.</Text>
                  </View>
                  <Pressable
                    onPress={closeBookModal}
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
                        ref={(r) => {
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
                        <Text style={styles.modalEmpty}>Aucun livre pour le moment.</Text>
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
                            const has = memoryId ? b.memoryIds.includes(memoryId) : false;
                            const coverUri = coverUriForBook(b);
                            return (
                              <View key={b.id} style={[styles.modalBookRow, has && styles.modalBookRowActive]}>
                                <Pressable
                                  onPress={() => {
                                    closeBookModal();
                                    router.push({ pathname: '/book-preview', params: { bookId: b.id } });
                                  }}
                                  style={({ pressed }) => [styles.modalThumbWrap, pressed && { opacity: 0.92 }]}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Éditer le livre ${b.title}`}
                                >
                                  <View style={styles.modalThumb}>
                                    {coverUri ? (
                                      <Image
                                        source={{ uri: coverUri }}
                                        style={StyleSheet.absoluteFillObject}
                                        resizeMode="cover"
                                      />
                                    ) : (
                                      <View style={styles.modalThumbPh}>
                                        <BookOpen size={scale(18)} color="#FFFFFF" strokeWidth={2.2} />
                                      </View>
                                    )}
                                  </View>
                                  {has ? (
                                    <View style={styles.modalThumbCheck} pointerEvents="none">
                                      <Check size={scale(14)} color="#FFFFFF" strokeWidth={3.2} />
                                    </View>
                                  ) : null}
                                </Pressable>
                                <Text style={styles.modalBookTitle} numberOfLines={1}>
                                  {b.title}
                                </Text>
                                {has ? (
                                  <TouchableOpacity
                                    style={styles.modalBookRemoveBtn}
                                    activeOpacity={0.9}
                                    onPress={() => void removeMemoryFromBookFromModal(b.id)}
                                    accessibilityRole="button"
                                    accessibilityLabel={`Retirer du livre ${b.title}`}
                                  >
                                    <Text style={styles.modalBookRemoveBtnText}>Retirer</Text>
                                  </TouchableOpacity>
                                ) : (
                                  <TouchableOpacity
                                    style={styles.modalBookAddBtn}
                                    activeOpacity={0.9}
                                    onPress={() => void addMemoryToBookFromModal(b.id)}
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
    backgroundColor: '#FFFFFF',
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(24),
  },
  errText: {
    fontSize: scale(16),
    color: '#6B7280',
    textAlign: 'center',
    marginBottom: verticalScale(12),
  },
  backLink: {
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(16),
  },
  backLinkText: {
    fontSize: scale(16),
    fontWeight: '600',
    color: THEME.accent,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: scale(8),
    paddingBottom: verticalScale(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
    backgroundColor: THEME.bg,
  },
  headerBtn: {
    padding: scale(8),
    minWidth: scale(44),
    minHeight: scale(44),
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  headerBtnRight: {
    padding: scale(8),
    minWidth: scale(44),
    minHeight: scale(44),
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: scale(17),
    fontWeight: '600',
    color: INK,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: verticalScale(12),
  },
  metaLine: {
    paddingHorizontal: scale(16),
    marginBottom: verticalScale(12),
  },
  metaText: {
    fontSize: scale(14),
    color: INK,
  },
  metaBold: {
    fontWeight: '700',
  },
  metaLight: {
    fontWeight: '400',
    color: '#8E8E93',
  },
  metaSep: {
    fontWeight: '400',
    color: '#8E8E93',
  },
  postMain: {
    width: '100%',
    backgroundColor: '#FAFAFA',
  },
  postBody: {
    overflow: 'visible',
  },
  mediaCard: {
    marginHorizontal: MEDIA_CARD_INSET,
    alignSelf: 'stretch',
    aspectRatio: 4 / 5,
    borderRadius: MEDIA_CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#ECECEF',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: verticalScale(2) },
        shadowOpacity: 0.05,
        shadowRadius: scale(10),
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  videoBody: {
    position: 'relative',
  },
  durationBadge: {
    position: 'absolute',
    right: scale(12),
    bottom: verticalScale(12),
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: scale(7),
    paddingVertical: verticalScale(3),
    borderRadius: scale(6),
  },
  durationText: {
    color: '#FFFFFF',
    fontSize: scale(11),
    fontWeight: '500',
  },
  audioBody: {
    minHeight: verticalScale(200),
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: FEED_GUTTER,
    paddingVertical: verticalScale(16),
    gap: verticalScale(14),
    position: 'relative',
    overflow: 'hidden',
  },
  audioBodyWithCover: {
    minHeight: verticalScale(260),
    marginHorizontal: MEDIA_CARD_INSET,
    borderRadius: MEDIA_CARD_RADIUS,
    overflow: 'hidden',
    paddingHorizontal: 0,
    paddingVertical: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: verticalScale(2) },
        shadowOpacity: 0.05,
        shadowRadius: scale(10),
      },
      android: { elevation: 2 },
      default: {},
    }),
  },
  voiceCoverBg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  voiceCoverScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.62)',
  },
  audioForeground: {
    position: 'relative',
    zIndex: 2,
    width: '100%',
    alignItems: 'center',
    gap: verticalScale(12),
  },
  audioForegroundCover: {
    position: 'absolute',
    left: scale(12),
    right: scale(12),
    bottom: verticalScale(10),
    zIndex: 2,
    alignItems: 'stretch',
    gap: 0,
  },
  audioPlayerWrap: {
    width: '100%',
    maxWidth: scale(340),
  },
  audioPlayerWrapCover: {
    maxWidth: '100%',
  },
  textBody: {
    backgroundColor: '#FFFFFF',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    paddingHorizontal: TEXT_POST_GUTTER,
    paddingVertical: verticalScale(32),
    marginHorizontal: MEDIA_CARD_INSET,
    borderRadius: MEDIA_CARD_RADIUS,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: POST_BORDER_SUBTLE,
    marginBottom: 0,
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: verticalScale(3) },
        shadowOpacity: 0.05,
        shadowRadius: scale(12),
      },
      android: {
        elevation: 2,
      },
      default: {},
    }),
  },
  textBookParagraphSpacing: {
    marginTop: verticalScale(20),
  },
  textContent: {
    width: '100%',
    alignSelf: 'stretch',
    fontSize: scale(17),
    fontWeight: '400',
    color: THEME.textPrimary,
    lineHeight: scale(28),
    textAlign: 'justify',
    ...Platform.select({
      android: {
        textBreakStrategy: 'highQuality' as const,
      },
      default: {},
    }),
  },
  postCaption: {
    minHeight: verticalScale(44),
    marginHorizontal: MEDIA_CARD_INSET,
    paddingTop: verticalScale(14),
    paddingBottom: verticalScale(12),
    paddingHorizontal: scale(14),
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: POST_BORDER_SUBTLE,
  },
  captionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
  },
  captionAnnotation: {
    fontSize: scale(15),
    fontWeight: '400',
    color: 'rgba(28, 28, 30, 0.82)',
    lineHeight: scale(24),
  },
  captionPlaceholder: {
    color: '#AEAEB2',
    fontStyle: 'italic',
  },
  bottomDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: DOCK_BG,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: POST_BORDER_SUBTLE,
  },
  dockCtaWrap: {
    paddingHorizontal: scale(14),
    paddingTop: verticalScale(10),
    paddingBottom: verticalScale(10),
    alignItems: 'center',
  },
  dockBookCta: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
    backgroundColor: '#0A0A0A',
    borderRadius: scale(999),
    paddingVertical: verticalScale(14),
    paddingHorizontal: scale(18),
  },
  dockBookCtaText: {
    fontSize: scale(15),
    fontWeight: '800',
    color: '#FFFFFF',
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: scale(16),
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: scale(16),
    padding: scale(18),
    maxHeight: '85%',
    overflow: 'hidden',
  },
  modalCardInner: {
    flexGrow: 1,
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
  modalThumbPh: {
    flex: 1,
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
    backgroundColor: '#0A0A0A',
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
    backgroundColor: '#0A0A0A',
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
