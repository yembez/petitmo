import { useEffect, useRef } from 'react';
import { ActivityIndicator, Alert, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { useShareIntentContext } from 'expo-share-intent';
import { THEME } from '@/constants/theme';
import {
  setPendingSharedImport,
  setPendingSharedVoice,
} from '@/lib/pendingShareMedia';
import {
  classifyShareFile,
  ingestSharedMediaFiles,
  ingestSharedVoice,
} from '@/services/shareIntentIngest';
import { useAppTranslation } from '@/hooks/useAppTranslation';

const SHARE_WAIT_MS = 8000;

/**
 * Handoff silencieux après Partager → Petitmo (Share Extension).
 * Local-first : copie sandbox puis navigation Capturer ; pas d’attente cloud.
 */
export default function ShareIntentScreen() {
  const router = useRouter();
  const { t } = useAppTranslation('common');
  const { hasShareIntent, shareIntent, resetShareIntent, error } =
    useShareIntentContext();
  const handledRef = useRef(false);

  useEffect(() => {
    const native = requireOptionalNativeModule('ExpoShareIntentModule');
    if (native != null) return;
    if (handledRef.current) return;
    handledRef.current = true;
    Alert.alert(t('error'), t('shareIntent.needsRebuild'));
    router.replace('/(tabs)');
  }, [router, t]);

  useEffect(() => {
    if (handledRef.current) return;
    const timer = setTimeout(() => {
      if (handledRef.current) return;
      handledRef.current = true;
      Alert.alert(t('error'), t('shareIntent.failed'));
      resetShareIntent(true);
      router.replace('/(tabs)');
    }, SHARE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [resetShareIntent, router, t]);

  useEffect(() => {
    if (handledRef.current) return;

    if (error) {
      handledRef.current = true;
      Alert.alert(t('error'), t('shareIntent.failed'));
      resetShareIntent(true);
      router.replace('/(tabs)');
      return;
    }

    /** `isReady` arrive avant `onChange` — ne pas rediriger tant qu’il n’y a pas de fichiers. */
    if (!hasShareIntent) return;

    handledRef.current = true;
    void (async () => {
      try {
        const files = shareIntent.files ?? [];
        if (files.length === 0) {
          resetShareIntent(true);
          router.replace('/(tabs)');
          return;
        }

        const kinds = files.map(classifyShareFile);
        const audioIdx = kinds.findIndex(k => k === 'audio');
        const mediaFiles = files.filter((_, i) => kinds[i] === 'image' || kinds[i] === 'video');

        if (audioIdx >= 0 && mediaFiles.length === 0) {
          const voice = await ingestSharedVoice(files[audioIdx]!);
          setPendingSharedVoice(voice);
          resetShareIntent(true);
          router.replace('/record-voice');
          return;
        }

        if (mediaFiles.length > 0) {
          const assets = await ingestSharedMediaFiles(mediaFiles);
          if (assets.length === 0) {
            Alert.alert(t('error'), t('shareIntent.unsupported'));
            resetShareIntent(true);
            router.replace('/(tabs)');
            return;
          }
          setPendingSharedImport(assets);
          resetShareIntent(true);
          router.replace('/import-media');
          return;
        }

        Alert.alert(t('error'), t('shareIntent.unsupported'));
        resetShareIntent(true);
        router.replace('/(tabs)');
      } catch (e) {
        console.error('[shareintent]', e);
        if (e instanceof Error && e.message === 'AUDIO_TOO_SHORT') {
          Alert.alert(t('error'), t('recordVoice.importTooShort'));
        } else {
          Alert.alert(t('error'), t('shareIntent.failed'));
        }
        resetShareIntent(true);
        router.replace('/(tabs)');
      }
    })();
  }, [error, hasShareIntent, resetShareIntent, router, shareIntent.files, t]);

  return (
    <View style={styles.shell}>
      <ActivityIndicator color={THEME.brandPrimary} />
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.bgScreen,
  },
});
