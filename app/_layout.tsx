import '@/lib/i18n';
import { useEffect, useLayoutEffect, useState } from 'react';
import { SplashScreen, Stack, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  View,
  StyleSheet,
  AppState,
  AppStateStatus,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as ScreenOrientation from 'expo-screen-orientation';
import { ShareIntentProvider } from 'expo-share-intent';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { THEME } from '@/constants/theme';
import { ensurePlaybackAudioForListening } from '@/lib/playbackAudioMode';
import { ensureSupabaseSession } from '@/lib/ensureSupabaseSession';
import { supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import { PendingMediaUploadsProvider } from '@/contexts/PendingMediaUploadsContext';
import { initLocalDb } from '@/lib/localDb';
import { resetUserTierForTesting } from '@/lib/userTier';
import { getUserTier } from '@/lib/userTier';
import { getUserMode } from '@/lib/userMode';
import { cleanOrphanedLocalFiles } from '@/lib/localCleanup';
import { getOrSelectFirstChild } from '@/services/children';
import { processPendingGuestRawUploads } from '@/services/pendingRawGuestUploads';
import {
  migrateBooksFromAsyncStorageToSqliteOnce,
  pruneOrphanEmptyBookDuplicates,
  restoreBooksFromSupabaseIfPremium,
  backupBooksToSupabaseIfPremium,
  flushPendingBookDeletesToSupabase,
} from '@/services/books';
import {
  setCaptureTabChildSnapshot,
  warmSelectedChildIdFromStorage,
} from '@/services/children';
import { setFeedHydrationSnapshots } from '@/services/tabScreensCache';
import {
  hydrateTabScreensFromLocal,
  hydrateTabScreensFromSqliteSync,
} from '@/services/tabScreensHydrate';
import { flushPendingCloudUploadsOnce } from '@/services/pendingCloudFlush';
import { APP_BOOT_FONT_SOURCES } from '@/constants/appBootFonts';
import { enrichSentryUserContext, initPetitmoSentry, Sentry } from '@/lib/sentry';

initPetitmoSentry();

/** OTA le plus tôt possible (avant auth / materialize) — pas de build natif. */
if (!__DEV__) {
  void import('@/services/applyOtaUpdate')
    .then(m => m.applyAvailableOtaUpdate({ waitForNativeDownloadMs: 25_000 }))
    .catch(() => {});
}

void SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  useFrameworkReady();
  const [bootFontsLoaded, bootFontsError] = useFonts(APP_BOOT_FONT_SOURCES);
  const bootFontsReady = bootFontsLoaded || !!bootFontsError;
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [forceBootPastSplash, setForceBootPastSplash] = useState(false);
  const pathname = usePathname();

  /** Portrait partout sauf prévisualisation livre (paysage au pivot). */
  useEffect(() => {
    if (!isAuthReady) return;
    void ensurePlaybackAudioForListening();
    void (async () => {
      try {
        const bookViewer = pathname.includes('book-preview');
        if (bookViewer) {
          await ScreenOrientation.unlockAsync();
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.ALL);
        } else {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
      } catch {
        /* ignore */
      }
    })();
  }, [isAuthReady, pathname]);

  useLayoutEffect(() => {
    initLocalDb();
    pruneOrphanEmptyBookDuplicates();
    void import('@/services/accountLocalReset').then(({ getLastRealAuthUserId }) =>
      getLastRealAuthUserId().then(() => {
        hydrateTabScreensFromSqliteSync();
      }),
    );
  }, []);

  useEffect(() => {
    // TEMPORAIRE — retirer avant la mise en production
    // void resetUserTierForTesting();
    // Migration durable : livres AsyncStorage → SQLite (one-shot).
    void migrateBooksFromAsyncStorageToSqliteOnce().then(() => {
      if (pruneOrphanEmptyBookDuplicates() > 0) {
        hydrateTabScreensFromSqliteSync();
      }
    });
    void runWeeklyCleanup();
    void processPendingGuestRawUploads();

    void warmSelectedChildIdFromStorage().then(async () => {
      const { getLastRealAuthUserId } = await import('@/services/accountLocalReset');
      await getLastRealAuthUserId();
      hydrateTabScreensFromSqliteSync();
    });

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void processPendingGuestRawUploads();
      }
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      try {
        const session = await ensureSupabaseSession();
        if (session.ok) {
          console.log('User authenticated:', session.userId);
          const { syncCloudAccountKindFromSession } = await import('@/lib/authAccount');
          await syncCloudAccountKindFromSession();
          // Warm cache sync pour hydratation / Capture scopés au compte.
          const { getLastRealAuthUserId } = await import('@/services/accountLocalReset');
          await getLastRealAuthUserId();
          void hydrateTabScreensFromLocal();
        } else {
          console.error('[auth]', session.error);
          if (!supabaseUrl || !supabaseAnonKey) {
            console.error(
              '[auth] Supabase non configuré (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY manquants).'
            );
          }
          setFeedHydrationSnapshots(null, [], []);
          setCaptureTabChildSnapshot(null);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setIsAuthReady(true);
      }
    };

    void initAuth();
  }, []);

  /** Relance OTA après auth si le fetch au boot n’a pas suffi. */
  useEffect(() => {
    if (!isAuthReady) return;
    const t = setTimeout(() => {
      void import('@/services/applyOtaUpdate').then(m => m.applyAvailableOtaUpdate());
    }, 800);
    return () => clearTimeout(t);
  }, [isAuthReady]);

  /** Token push : fond uniquement, après session (permission déjà accordée ou non). */
  useEffect(() => {
    if (!isAuthReady) return;
    void import('@/services/registerPushToken').then(m => m.registerPushTokenInBackground());
  }, [isAuthReady]);

  /** Tap sur une notif → ouvrir Capturer (écran d’accueil). */
  useEffect(() => {
    if (!isAuthReady) return;
    let cleanup: (() => void) | undefined;
    void import('@/services/pushNotificationOpen')
      .then(m => m.installPushNotificationOpenHandlers())
      .then(fn => {
        cleanup = fn;
      });
    return () => cleanup?.();
  }, [isAuthReady]);

  async function runWeeklyCleanup(): Promise<void> {
    const CLEANUP_KEY = 'petitmo_last_cleanup'
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000

    try {
      const lastStr = await AsyncStorage.getItem(CLEANUP_KEY)
      const last = lastStr ? Number.parseInt(lastStr, 10) : 0
      const now = Date.now()

      if (now - last < ONE_WEEK_MS) return

      const childId = await getOrSelectFirstChild()
      if (!childId) return

      await cleanOrphanedLocalFiles(childId)
      await AsyncStorage.setItem(CLEANUP_KEY, String(now))
    } catch {
      // Silencieux
    }
  }

  /** Retour au premier plan : réaligner cache onglets (robuste après sync / autre appareil). */
  useEffect(() => {
    if (!isAuthReady) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        debounce = null;
        void warmSelectedChildIdFromStorage()
          .then(() => {
            hydrateTabScreensFromSqliteSync();
            // Flush upload = fond uniquement (pas d’invalidate UI).
            return flushPendingCloudUploadsOnce();
          })
          .then(() => {
            // Local d’abord ; pull cloud en fond → `memories-updated` soft si merge.
            void hydrateTabScreensFromLocal();
            void import('@/services/registerPushToken').then(m => m.registerPushTokenInBackground());
          });
      }, 450);
    });
    return () => {
      sub.remove();
      if (debounce) clearTimeout(debounce);
    };
  }, [isAuthReady]);

  // Backup / restore livres (compte produit gratuit ou paid) : après auth ready.
  useEffect(() => {
    if (!isAuthReady) return;
    // Ordre important:
    // 1) restauration cloud → SQLite
    // 2) puis backup (merge “le plus récent gagne”, donc sans perte)
    void (async () => {
      await flushPendingBookDeletesToSupabase();
      await restoreBooksFromSupabaseIfPremium();
      if (pruneOrphanEmptyBookDuplicates() > 0) {
        hydrateTabScreensFromSqliteSync();
      }
      await backupBooksToSupabaseIfPremium();
      await warmSelectedChildIdFromStorage();
      hydrateTabScreensFromSqliteSync();
      // Sync-only : pas d’invalidate (favoris/fil ne doivent pas recharger « pour le cloud »).
      await flushPendingCloudUploadsOnce();
      void hydrateTabScreensFromLocal();
    })();
  }, [isAuthReady]);

  useEffect(() => {
    if (!isAuthReady) return;
    void (async () => {
      const [tier, userMode] = await Promise.all([getUserTier(), getUserMode()]);
      await enrichSentryUserContext({ tier, userMode });
    })();
  }, [isAuthReady]);

  useEffect(() => {
    if (!isAuthReady || !bootFontsReady) return;
    void SplashScreen.hideAsync();
  }, [bootFontsReady, isAuthReady]);

  /** Filet anti-blocage splash (fonts / auth / OTA incompatible) — local-first. */
  useEffect(() => {
    const t = setTimeout(() => {
      setForceBootPastSplash(true);
      setIsAuthReady(true);
      void SplashScreen.hideAsync();
    }, 6000);
    return () => clearTimeout(t);
  }, []);

  if ((!isAuthReady || !bootFontsReady) && !forceBootPastSplash) {
    return <View style={styles.bootShell} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PendingMediaUploadsProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { flex: 1, backgroundColor: THEME.bgScreen },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen
          name="onboarding"
          options={{
            contentStyle: { flex: 1, backgroundColor: '#2A1A14' },
            animation: 'fade',
          }}
        />
        <Stack.Screen
          name="auth"
          options={{
            contentStyle: { flex: 1, backgroundColor: '#2A1A14' },
            animation: 'fade',
          }}
        />
        <Stack.Screen name="auth-verify-otp" />
        <Stack.Screen name="create-child" />
        <Stack.Screen name="onboarding-permissions" />
        <Stack.Screen name="edit-child" />
        <Stack.Screen name="parent-space" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="write" />
        <Stack.Screen name="camera" />
        <Stack.Screen name="record-voice" />
        <Stack.Screen name="import-media" />
        <Stack.Screen
          name="shareintent"
          options={{
            animation: 'none',
            contentStyle: { flex: 1, backgroundColor: THEME.bgScreen },
          }}
        />
        <Stack.Screen name="edit-photo" />
        <Stack.Screen
          name="memory-viewer"
          options={{
            presentation: 'fullScreenModal',
            animation: 'slide_from_bottom',
            contentStyle: { flex: 1, backgroundColor: THEME.bgScreen },
          }}
        />
        <Stack.Screen name="memory-view" />
        <Stack.Screen
          name="book-preview"
          options={{
            animation: 'slide_from_right',
            /** Favoris → replace : transition « retour » (spread glisse depuis la gauche). */
            animationTypeForReplace: 'pop',
            gestureEnabled: true,
            fullScreenGestureEnabled: true,
            contentStyle: { flex: 1, backgroundColor: THEME.bg },
          }}
        />
        <Stack.Screen
          name="book-add-favoris"
          options={{
            presentation: 'fullScreenModal',
            animation: 'none',
            gestureEnabled: true,
            contentStyle: { flex: 1, backgroundColor: THEME.bg },
          }}
        />
        <Stack.Screen name="book-order" />
        <Stack.Screen name="book-order-return" options={{ headerShown: false }} />
        <Stack.Screen name="book-finalize-media" />
        <Stack.Screen name="book-order-confirmation" />
        <Stack.Screen name="capture-wheel-mock" />
        <Stack.Screen name="capture-applelike-mock" />
        <Stack.Screen name="+not-found" />
      </Stack>
      {/** Défaut fond clair : icônes statut foncées. `auto` suivait le thème OS (icônes claires en mode sombre) alors que l’UI reste claire. */}
      <StatusBar style="dark" />
      </PendingMediaUploadsProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  bootShell: {
    flex: 1,
    backgroundColor: THEME.bgScreen,
  },
});

function RootLayout() {
  return (
    <ShareIntentProvider
      options={{
        /** Logs natifs uniquement en Metro — évite du bruit / effets de bord en TestFlight. */
        debug: false,
        resetOnBackground: true,
      }}
    >
      <RootLayoutNav />
    </ShareIntentProvider>
  );
}

export default Sentry.wrap(RootLayout);