import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  InteractionManager,
  DeviceEventEmitter,
  type StyleProp,
  type ViewStyle,
  type ViewProps,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { scale, verticalScale } from '@/utils/responsive';
import EditTextModal from '@/components/EditTextModal';
import { feedMemoryTextEditPreviewVariant } from '@/utils/memoryTextEditStyles';
import { bookLineBudgetForMemoryType, bookCharsPerLineForMemoryType } from '@/utils/textLimits';
import { useFeedVideoAutoplay } from '@/hooks/useFeedVideoAutoplay';
import { usePrefetchMemories } from '@/hooks/usePrefetchMemories';
import { usePendingMediaUploads } from '@/contexts/PendingMediaUploadsContext';
import { useFeedData } from '@/hooks/useFeedData';
import { useToggleFavorite } from '@/hooks/useToggleFavorite';
import { useFilFeedList } from '@/hooks/useFilFeedList';
import { useFeedMetaFonts } from '@/hooks/useFeedMetaFonts';
import { useFilRowActions } from '@/hooks/useFilRowActions';
import { styles } from '@/components/feed/feedStyles';
import { THEME } from '@/constants/theme';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { PETITMO_CTA_BORDER_WIDTH, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';
import { FeedHeader } from '@/components/feed/FeedHeader';
import SettingsHeaderButton from '@/components/SettingsHeaderButton';
import type { FeedListItem } from '@/components/feed/FilMemoryRow';
import { peekSilentInitialFilLoadArmed } from '@/services/feedAfterImportFlags';
import { setMemoryViewerSession } from '@/services/memoryViewerSession';
import {
  consumeFeedScrollIntent,
  setFeedScrollRestoreOffset,
  PETITMO_FIL_NEWEST_REMOVED,
  type FeedScrollIntent,
} from '@/services/feedScrollRestore';
import { useFocusEffect } from '@react-navigation/native';
import { getTimingNudge, markNudgeSeen, recordInstallDate } from '@/lib/paywallTiming';
import type { Child } from '@/types/local';
import TabSceneTransition from '@/components/TabSceneTransition';

function FilScreen() {
  const router = useRouter();
  const { t } = useAppTranslation('common');
  const { pending: pendingUploads } = usePendingMediaUploads();
  const insets = useSafeAreaInsets();
  const [timingNudge, setTimingNudge] = useState<'DAY_30' | 'DAY_60' | null>(null);
  const {
    memories,
    setMemories,
    child,
    familyChildren,
    isLoading,
    isRefreshing,
    onRefresh,
    memoryFlatListKeyByIdRef,
  } = useFeedData(pendingUploads);

  const {
    swipeRefs,
    editModalVisible,
    editingMemory,
    editLocationModalVisible,
    editingLocationMemory,
    uploadingVoiceCoverId,
    handleEditMemory,
    handleSaveEdit,
    handleEditLocation,
    handleSaveLocation,
    handlePickVoiceCover,
    handleDeleteMemory,
    closeEditModal,
    closeEditLocationModal,
  } = useFilRowActions(setMemories);

  const { onViewableItemsChanged: onPrefetchViewable } = usePrefetchMemories();
  const {
    feedViewabilityPairs,
    refreshFeedVideoAutoplay,
    suspendFeedInlineVideo,
    onFeedScrollBegin,
    onFeedScrollIdle,
  } = useFeedVideoAutoplay(onPrefetchViewable);
  const onFeedHeaderChildPress = useCallback(
    (target: Child) => {
      router.push(`/edit-child?childId=${target.id}`);
    },
    [router],
  );
  const listRef = useRef<FlatList<FeedListItem> | null>(null);
  const feedScrollOffsetRef = useRef(0);
  const pendingScrollIntentRef = useRef<FeedScrollIntent | null>(null);
  const [feedListOpacity, setFeedListOpacity] = useState(1);
  const immersiveLaunchRef = useRef<(memoryId: string, albumPhotoIndex?: number) => void>(() => {});
  immersiveLaunchRef.current = (memoryId: string, albumPhotoIndex = 0) => {
    const memoryIndex = memories.findIndex(m => m.id === memoryId);
    if (memoryIndex < 0) return;
    setFeedScrollRestoreOffset(feedScrollOffsetRef.current);
    suspendFeedInlineVideo();
    setMemoryViewerSession({
      memories,
      initialIndex: memoryIndex,
      initialAlbumPhotoIndex: albumPhotoIndex,
      familyChildren,
    });
    router.push({
      pathname: '/memory-viewer',
      params: { initialIndex: String(memoryIndex) },
    });
  };
  const toggleFavorite = useToggleFavorite(setMemories);
  const {
    feedDateFontFamily,
    feedAgeFontFamily,
    feedLocationFilledFontFamily,
    feedLocationPlaceholderFontFamily,
  } = useFeedMetaFonts();

  const renderFilListCell = useCallback(
    (props: { style?: StyleProp<ViewStyle>; children: ReactNode; onLayout?: ViewProps['onLayout'] }) => (
      <View style={[props.style, styles.feedListCell]} onLayout={props.onLayout}>
        {props.children}
      </View>
    ),
    []
  );

  const { feedData, renderItem } = useFilFeedList(
    memories,
    setMemories,
    child,
    familyChildren,
    feedDateFontFamily,
    feedAgeFontFamily,
    feedLocationFilledFontFamily,
    feedLocationPlaceholderFontFamily,
    pendingUploads,
    uploadingVoiceCoverId,
    toggleFavorite,
    handleEditMemory,
    handleEditLocation,
    handlePickVoiceCover,
    handleDeleteMemory,
    swipeRefs,
    immersiveLaunchRef,
  );

  const listBottomPad = useMemo(
    () => verticalScale(28) + tabBarFloatingOverlapPad(insets.bottom),
    [insets.bottom],
  );
  const listContentContainerStyle = useMemo(
    () => [styles.scrollContent, { paddingBottom: listBottomPad }],
    [listBottomPad],
  );
  const onFeedScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      feedScrollOffsetRef.current = e.nativeEvent.contentOffset.y;
    },
    [],
  );

  const onFeedScrollActive = useCallback(() => {
    onFeedScrollBegin();
  }, [onFeedScrollBegin]);

  const onFeedScrollStopped = useCallback(() => {
    onFeedScrollIdle();
  }, [onFeedScrollIdle]);
  const keyExtractor = useCallback(
    (item: FeedListItem) =>
      item.rowKind === 'pending'
        ? item.row.tempId
        : memoryFlatListKeyByIdRef.current.get(item.memory.id) ?? item.memory.id,
    [memoryFlatListKeyByIdRef],
  );

  const applyPendingFeedScrollIntent = useCallback(() => {
    const intent = pendingScrollIntentRef.current;
    if (!intent || !listRef.current || feedData.length === 0) return false;

    if (intent.type === 'snapToKey') {
      const key = intent.key;
      const index = feedData.findIndex(item =>
        item.rowKind === 'pending'
          ? item.row.tempId === key || item.row.committedMemory?.id === key
          : item.memory.id === key ||
            memoryFlatListKeyByIdRef.current.get(item.memory.id) === key,
      );
      if (index >= 0) {
        try {
          listRef.current.scrollToIndex({ index, animated: false, viewPosition: 0 });
        } catch {
          listRef.current.scrollToOffset({ offset: 0, animated: false });
        }
      } else {
        listRef.current.scrollToOffset({ offset: 0, animated: false });
      }
      pendingScrollIntentRef.current = null;
      setFeedListOpacity(1);
      return true;
    }

    const offsetY = intent.type === 'restore' ? intent.offsetY : 0;
    listRef.current.scrollToOffset({ offset: offsetY, animated: false });
    feedScrollOffsetRef.current = offsetY;
    pendingScrollIntentRef.current = null;
    setFeedListOpacity(1);
    return true;
  }, [feedData, memoryFlatListKeyByIdRef]);

  const onFeedContentSizeChange = useCallback(() => {
    if (pendingScrollIntentRef.current) {
      applyPendingFeedScrollIntent();
    }
  }, [applyPendingFeedScrollIntent]);

  useFocusEffect(
    useCallback(() => {
      const intent = consumeFeedScrollIntent();
      let scrollTask: { cancel: () => void } | undefined;
      if (intent) {
        pendingScrollIntentRef.current = intent;
        setFeedListOpacity(0);
        scrollTask = InteractionManager.runAfterInteractions(() => {
          applyPendingFeedScrollIntent();
        });
      }

      const viewabilityFrame = requestAnimationFrame(() => {
        listRef.current?.recordInteraction?.();
        refreshFeedVideoAutoplay();
      });

      void recordInstallDate();
      void getTimingNudge().then(nudge => {
        if (!nudge) return;
        void markNudgeSeen();
        if (nudge === 'DAY_90') {
          router.push({ pathname: '/paywall', params: { context: nudge } });
          return;
        }
        if (nudge === 'DAY_30' || nudge === 'DAY_60') {
          setTimingNudge(nudge);
        }
      });

      return () => {
        cancelAnimationFrame(viewabilityFrame);
        scrollTask?.cancel();
        suspendFeedInlineVideo();
      };
    }, [router, applyPendingFeedScrollIntent, refreshFeedVideoAutoplay, suspendFeedInlineVideo]),
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(PETITMO_FIL_NEWEST_REMOVED, () => {
      const snapTop = () => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        feedScrollOffsetRef.current = 0;
      };
      snapTop();
      requestAnimationFrame(snapTop);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (feedListOpacity !== 0) return;
    const fallback = setTimeout(() => {
      pendingScrollIntentRef.current = null;
      setFeedListOpacity(1);
    }, 500);
    return () => clearTimeout(fallback);
  }, [feedListOpacity]);

  /** Import / replace vers le fil déjà actif : le focus ne repasse pas, on consomme l’intent au changement de données. */
  useEffect(() => {
    if (pendingScrollIntentRef.current) {
      applyPendingFeedScrollIntent();
      return;
    }
    const intent = consumeFeedScrollIntent();
    if (!intent) return;
    pendingScrollIntentRef.current = intent;
    setFeedListOpacity(0);
    applyPendingFeedScrollIntent();
  }, [feedData.length, pendingUploads.length, applyPendingFeedScrollIntent]);

  /** Pas d’écran plein pendant l’import : pending, flag « retour import », ou 1er rendu avant consume. */
  if (isLoading && pendingUploads.length === 0 && !peekSilentInitialFilLoadArmed()) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={THEME.brandCtaOrange} />
      </View>
    );
  }

  if (familyChildren.length === 0 && pendingUploads.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="dark" />
        <View
          style={{
            position: 'absolute',
            top: insets.top + verticalScale(6),
            right: scale(20),
            zIndex: 2,
          }}
        >
          <SettingsHeaderButton />
        </View>
        <Text style={styles.emptyText}>Aucun enfant trouvé</Text>
        <PetitmoPrimaryPressable
          style={styles.createButton}
          onPress={() => router.push('/create-child')}
        >
          <Text style={[petitmoCtaStyles.primaryText, styles.createButtonText]}>Créer un profil</Text>
        </PetitmoPrimaryPressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.headerShell}>
        <FeedHeader
          familyChildren={familyChildren}
          paddingTop={insets.top + verticalScale(6)}
          onPressChild={onFeedHeaderChildPress}
        />
      </View>
      <View style={[styles.feedViewport, { opacity: feedListOpacity }]}>
        <FlatList<FeedListItem>
          ref={listRef}
          data={feedData}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          CellRendererComponent={renderFilListCell}
          viewabilityConfigCallbackPairs={feedViewabilityPairs}
          onScroll={onFeedScroll}
          onScrollBeginDrag={onFeedScrollActive}
          onMomentumScrollBegin={onFeedScrollActive}
          onScrollEndDrag={onFeedScrollStopped}
          onMomentumScrollEnd={onFeedScrollStopped}
          scrollEventThrottle={16}
          onContentSizeChange={onFeedContentSizeChange}
          onScrollToIndexFailed={info => {
            listRef.current?.scrollToOffset({
              offset: Math.max(0, info.averageItemLength * info.index),
              animated: false,
            });
          }}
          bounces={false}
          overScrollMode="never"
          alwaysBounceVertical={false}
          style={styles.scrollView}
          contentContainerStyle={listContentContainerStyle}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={THEME.brandCtaOrange} />
          }
          ListEmptyComponent={
            feedData.length === 0 ? (
              <View style={[styles.emptyContainer, { minHeight: verticalScale(420) }]}>
                <TouchableOpacity
                  style={localStyles.emptyPlusDisc}
                  activeOpacity={0.85}
                  onPress={() => router.navigate('/(tabs)')}
                  accessibilityRole="button"
                  accessibilityLabel={t('fil.empty.addA11y')}
                >
                  <Plus
                    size={scale(36)}
                    color={THEME.captureCtaBorderColor}
                    fill="none"
                    strokeWidth={2}
                  />
                </TouchableOpacity>
                <Text style={localStyles.emptyTitle}>{t('fil.empty.title')}</Text>
                <Text style={localStyles.emptySubtitle}>{t('fil.empty.subtitle')}</Text>
              </View>
            ) : null
          }
          removeClippedSubviews={false}
          // Ancre le contenu visible quand des cellules au-dessus du viewport se re-mesurent
          // (virtualisation, hauteurs variables sans getItemLayout).
          // autoscrollToTopThreshold : si on est en haut, rester en haut (ex. suppression du dernier souvenir).
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: Math.round(verticalScale(80)),
          }}
          initialNumToRender={6}
          // Lots plus petits + fenêtre plus étroite : chaque FilMemoryRow est lourd (Swipeable,
          // mosaïque, overlays, éventuel <Video>) — monter 4 lignes d'un coup gelait le JS pendant le scroll.
          maxToRenderPerBatch={2}
          updateCellsBatchingPeriod={40}
          windowSize={7}
        />
      </View>
      {timingNudge && (
        <TouchableOpacity
          style={[localStyles.nudgeBanner, { bottom: Math.max(insets.bottom, 0) + verticalScale(10) }]}
          activeOpacity={0.9}
          onPress={() => {
            router.push({ pathname: '/paywall', params: { context: timingNudge } });
            setTimingNudge(null);
          }}
        >
          <Text style={localStyles.nudgeText} numberOfLines={2}>
            {timingNudge === 'DAY_30'
              ? "Tes souvenirs méritent d'être protégés ♡"
              : 'Ne perds aucun moment — passe à Petitmo+'}
          </Text>
          <Text style={localStyles.nudgeCta}>Découvrir →</Text>
        </TouchableOpacity>
      )}
      <EditTextModal
        key={editingMemory?.id ?? 'edit-caption-modal-closed'}
        visible={editModalVisible}
        initialText={editingMemory?.content?.trim() ?? ''}
        previewVariant={feedMemoryTextEditPreviewVariant(editingMemory?.type)}
        bookLineBudget={bookLineBudgetForMemoryType(editingMemory?.type)}
        bookCharsPerLine={bookCharsPerLineForMemoryType(editingMemory?.type)}
        title={
          !editingMemory
            ? 'Modifier le texte'
            : editingMemory.content?.trim()
              ? 'Modifier l’annotation'
              : 'Annoter'
        }
        onClose={closeEditModal}
        onSave={handleSaveEdit}
      />
      <EditTextModal
        key={editingLocationMemory?.id ?? 'edit-location-modal-closed'}
        visible={editLocationModalVisible}
        initialText={editingLocationMemory?.location?.trim() ?? ''}
        title="Modifier le lieu"
        onClose={closeEditLocationModal}
        onSave={handleSaveLocation}
      />
    </View>
  );
}

export default function FilScreenTab() {
  return (
    <TabSceneTransition>
      <FilScreen />
    </TabSceneTransition>
  );
}

const EMPTY_PLUS_DISC = scale(76);

const localStyles = StyleSheet.create({
  /** Même disque contour « + » que l’onglet Capturer, en grand format. */
  emptyPlusDisc: {
    width: EMPTY_PLUS_DISC,
    height: EMPTY_PLUS_DISC,
    borderRadius: EMPTY_PLUS_DISC / 2,
    borderWidth: PETITMO_CTA_BORDER_WIDTH,
    borderColor: THEME.captureCtaBorderColor,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(22),
  },
  emptyTitle: {
    fontSize: scale(20),
    fontWeight: '600',
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: verticalScale(10),
  },
  emptySubtitle: {
    fontSize: scale(16),
    lineHeight: scale(23),
    color: THEME.textMuted,
    textAlign: 'center',
  },
  nudgeBanner: {
    position: 'absolute',
    left: 20,
    right: 20,
    backgroundColor: '#1C1C1E',
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 14,
  },
  nudgeText: {
    color: '#FFFFFF',
    fontSize: 13,
    flex: 1,
  },
  nudgeCta: {
    color: THEME.brandCtaOrange,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
  },
});
