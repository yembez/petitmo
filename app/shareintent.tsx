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
import { isSentryEnabled, Sentry } from '@/lib/sentry';

/** AirDrop / Fichiers iCloud : le payload arrive souvent après le deep link. */
const SHARE_WAIT_MS = 20000;

function shareFilesMeta(files: { mimeType?: string | null; fileName?: string | null }[]) {
  return {
    fileCount: files.length,
    mimes: files.map(f => (f.mimeType ?? '').slice(0, 80)),
    exts: files.map(f => {
      const n = (f.fileName ?? '').split('.').pop()?.toLowerCase() ?? '';
      return n.length > 0 && n.length <= 5 ? n : '';
    }),
  };
}

function reportShareIntentFail(
  reason: 'timeout' | 'context' | 'ingest' | 'unsupported' | 'empty' | 'rebuild',
  err?: unknown,
  extra?: Record<string, unknown>,
) {
  const scoped = `shareIntent.${reason}`;
  const toCapture =
    err instanceof Error ? err : new Error(typeof err === 'string' ? err : scoped);
  if (!isSentryEnabled()) {
    console.warn('[shareintent]', scoped, toCapture.message, extra);
    return;
  }
  Sentry.captureException(toCapture, {
    tags: { 'app.errorScope': scoped },
    extra: extra ?? {},
  });
}

/**
 * Handoff silencieux après Partager → Petit Cœur (Share Extension).
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
    reportShareIntentFail('rebuild', new Error('ExpoShareIntentModule missing'));
    Alert.alert(t('error'), t('shareIntent.needsRebuild'));
    router.replace('/(tabs)');
  }, [router, t]);

  useEffect(() => {
    if (handledRef.current) return;
    const timer = setTimeout(() => {
      if (handledRef.current) return;
      handledRef.current = true;
      reportShareIntentFail('timeout', new Error(`share_intent_wait_${SHARE_WAIT_MS}`));
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
      reportShareIntentFail('context', error, {
        error: String(error).slice(0, 200),
      });
      Alert.alert(t('error'), t('shareIntent.failed'));
      resetShareIntent(true);
      router.replace('/(tabs)');
      return;
    }

    /** `isReady` arrive avant `onChange` — ne pas rediriger tant qu’il n’y a pas de fichiers. */
    if (!hasShareIntent) return;

    handledRef.current = true;
    void (async () => {
      const files = shareIntent.files ?? [];
      try {
        if (files.length === 0) {
          reportShareIntentFail('empty', new Error('share_intent_no_files'));
          Alert.alert(t('error'), t('shareIntent.failed'));
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
            reportShareIntentFail(
              'unsupported',
              new Error('share_intent_media_ingest_empty'),
              shareFilesMeta(files),
            );
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

        reportShareIntentFail(
          'unsupported',
          new Error('share_intent_unknown_kinds'),
          { ...shareFilesMeta(files), kinds },
        );
        Alert.alert(t('error'), t('shareIntent.unsupported'));
        resetShareIntent(true);
        router.replace('/(tabs)');
      } catch (e) {
        console.error('[shareintent]', e);
        reportShareIntentFail('ingest', e, shareFilesMeta(files));
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
