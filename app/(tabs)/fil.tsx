import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type ViewProps,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { verticalScale } from '@/utils/responsive';
import EditTextModal from '@/components/EditTextModal';
import { usePrefetchMemories } from '@/hooks/usePrefetchMemories';
import { useFeedVideoAutoplay } from '@/hooks/useFeedVideoAutoplay';
import { usePendingMediaUploads } from '@/contexts/PendingMediaUploadsContext';
import { useFeedData } from '@/hooks/useFeedData';
import { useToggleFavorite } from '@/hooks/useToggleFavorite';
import { useFilFeedList } from '@/hooks/useFilFeedList';
import { useFilLayout } from '@/hooks/useFilLayout';
import { useFilRowActions } from '@/hooks/useFilRowActions';
import { styles } from '@/components/feed/feedStyles';
import { THEME } from '@/constants/theme';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';
import { FeedHeader } from '@/components/feed/FeedHeader';
import type { FeedListItem } from '@/components/feed/FilMemoryRow';
import { peekSilentInitialFilLoadArmed } from '@/services/feedAfterImportFlags';
import { setMemoryViewerSession } from '@/services/memoryViewerSession';
import { useFocusEffect } from '@react-navigation/native';
import { getTimingNudge, markNudgeSeen, recordInstallDate } from '@/lib/paywallTiming';

export default function FilScreen() {
  const router = useRouter();
  const { pending: pendingUploads } = usePendingMediaUploads();
  const insets = useSafeAreaInsets();
  const [timingNudge, setTimingNudge] = useState<'DAY_30' | 'DAY_60' | null>(null);
  const {
    memories,
    setMemories,
    child,
    isLoading,
    isRefreshing,
    onRefresh,
    memoryFlatListKeyByIdRef,
  } = useFeedData(pendingUploads);

  const { setPostHeights } = useFilLayout({ memories });

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
  const { feedAutoplayMemoryId, onViewableItemsChanged, suspendFeedInlineVideo } =
    useFeedVideoAutoplay(onPrefetchViewable);
  const feedViewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 50, minimumViewTime: 80 }),
    []
  );
  const onFeedHeaderMenuPress = useCallback(() => {
    router.push('/parent-space');
  }, [router]);
  const listRef = useRef<FlatList<FeedListItem> | null>(null);
  const immersiveLaunchRef = useRef<(index: number) => void>(() => {});
  immersiveLaunchRef.current = (index: number) => {
    suspendFeedInlineVideo();
    setMemoryViewerSession({ memories, initialIndex: index });
    router.push({
      pathname: '/memory-viewer',
      params: { initialIndex: String(index) },
    });
  };
  const toggleFavorite = useToggleFavorite(setMemories);

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
    pendingUploads,
    uploadingVoiceCoverId,
    setPostHeights,
    toggleFavorite,
    handleEditMemory,
    handleEditLocation,
    handlePickVoiceCover,
    handleDeleteMemory,
    swipeRefs,
    immersiveLaunchRef,
    feedAutoplayMemoryId
  );

  useFocusEffect(
    useCallback(() => {
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
    }, [router])
  );

  /** Pas d’écran plein pendant l’import : pending, flag « retour import », ou 1er rendu avant consume. */
  if (isLoading && pendingUploads.length === 0 && !peekSilentInitialFilLoadArmed()) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={THEME.brandPrimary} />
      </View>
    );
  }

  if (!child && pendingUploads.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="dark" />
        <Text style={styles.emptyText}>Aucun enfant trouvé</Text>
        <TouchableOpacity
          style={[petitmoCtaStyles.primary, styles.createButton]}
          onPress={() => router.push('/create-child')}
        >
          <Text style={[petitmoCtaStyles.primaryText, styles.createButtonText]}>Créer un profil</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.headerShell}>
        <FeedHeader
          child={child}
          paddingTop={insets.top + verticalScale(6)}
          onMenuPress={onFeedHeaderMenuPress}
        />
      </View>
      <View style={styles.feedViewport}>
        <FlatList<FeedListItem>
          ref={listRef}
          data={feedData}
          keyExtractor={item =>
            item.rowKind === 'pending'
              ? item.row.tempId
              : memoryFlatListKeyByIdRef.current.get(item.memory.id) ?? item.memory.id
          }
          renderItem={renderItem}
          CellRendererComponent={renderFilListCell}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={feedViewabilityConfig}
          style={styles.scrollView}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: verticalScale(28) + tabBarFloatingOverlapPad(insets.bottom) },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={THEME.brandPrimary} />
          }
          ListEmptyComponent={
            feedData.length === 0 ? (
              <View style={[styles.emptyContainer, { minHeight: verticalScale(420) }]}>
                <Text style={styles.emptyText}>Aucun souvenir pour le moment</Text>
                <Text style={styles.emptySubText}>Commencez a capturer des moments precieux</Text>
              </View>
            ) : null
          }
          removeClippedSubviews={false}
          maintainVisibleContentPosition={{
            minIndexForVisible: 0,
            autoscrollToTopThreshold: Math.round(verticalScale(80)),
          }}
          initialNumToRender={4}
          maxToRenderPerBatch={6}
          windowSize={9}
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
        key={editingMemory?.id ?? 'edit-modal-closed'}
        visible={editModalVisible}
        initialText={editingMemory?.content?.trim() ?? ''}
        title={
          !editingMemory
            ? 'Modifier le texte'
            : editingMemory.type === 'text'
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

const localStyles = StyleSheet.create({
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
    color: THEME.brandPrimary,
    fontSize: 13,
    fontWeight: '600',
    marginLeft: 8,
  },
});
