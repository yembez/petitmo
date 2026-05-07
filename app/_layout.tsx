import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  AppState,
  AppStateStatus,
  DeviceEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { THEME } from '@/constants/theme';
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import { PendingMediaUploadsProvider } from '@/contexts/PendingMediaUploadsContext';
import { initLocalDb } from '@/lib/localDb';
import { resetUserTierForTesting } from '@/lib/userTier';
import { cleanOrphanedLocalFiles } from '@/lib/localCleanup';
import { getOrSelectFirstChild } from '@/services/children';
import { processPendingGuestRawUploads } from '@/services/pendingRawGuestUploads';
import {
  migrateBooksFromAsyncStorageToSqliteOnce,
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

export default function RootLayout() {
  useFrameworkReady();
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Orientation globale: portrait (sauf écrans spécifiques qui unlock).
  useEffect(() => {
    void (async () => {
      try {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    initLocalDb();
    // TEMPORAIRE — retirer avant la mise en production
    // void resetUserTierForTesting();
    // Migration durable : livres AsyncStorage → SQLite (one-shot).
    void migrateBooksFromAsyncStorageToSqliteOnce();
    void runWeeklyCleanup();
    void processPendingGuestRawUploads();

    /**
     * En parallèle de l’auth : ID enfant depuis AsyncStorage puis cache onglets **SQLite pur**
     * → onglets peuvent déjà avoir données locales au 1er rendu (multi-enfants : ID connu dès que la promesse résout).
     */
    void warmSelectedChildIdFromStorage().then(() => {
      hydrateTabScreensFromSqliteSync();
    });

    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        void processPendingGuestRawUploads();
      }
    });

    return () => sub.remove();
  }, []);

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

  useEffect(() => {
    const initAuth = async () => {
      try {
        if (!supabaseUrl || !supabaseAnonKey) {
          console.error(
            '[auth] Supabase non configuré (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY manquants).'
          );
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();

        if (!session) {
          let deviceId = await AsyncStorage.getItem('@petitmo_device_id');

          if (!deviceId) {
            deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            await AsyncStorage.setItem('@petitmo_device_id', deviceId);
          }

          const apiUrl = `${supabaseUrl}/functions/v1/create-device-user`;

          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${supabaseAnonKey}`,
              apikey: supabaseAnonKey,
            },
            body: JSON.stringify({ deviceId }),
          });

          const result = await response.json();

          if (!response.ok) {
            console.error('Failed to create device user:', result);
          } else {
            console.log('Device user created/verified:', result);
          }

          const email = `${deviceId}@petitmo.local`;
          const password = deviceId;

          const { error: signInError } = await supabase.auth.signInWithPassword({
            email,
            password,
          });

          if (signInError) {
            console.error('Sign in error:', signInError);
          }
        }

        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          console.log('User authenticated:', user.id);
          /** Enfant + souvenirs + livres en local avant le 1er rendu des onglets → pas de roue au 1er tap. */
          await hydrateTabScreensFromLocal();
        } else {
          console.error('No user after auth');
          setFeedHydrationSnapshots(null, [], []);
          setCaptureTabChildSnapshot(null);
        }
      } catch (error) {
        console.error('Auth initialization error:', error);
      } finally {
        setIsAuthReady(true);
      }
    };

    initAuth();
  }, []);

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
            return flushPendingCloudUploadsOnce();
          })
          .then(() => hydrateTabScreensFromLocal())
          .then(() => {
            DeviceEventEmitter.emit('petitmo:memories-invalidate');
          });
      }, 450);
    });
    return () => {
      sub.remove();
      if (debounce) clearTimeout(debounce);
    };
  }, [isAuthReady]);

  // Backup cloud (premium uniquement) : déclenché après auth ready.
  useEffect(() => {
    if (!isAuthReady) return;
    // Ordre important:
    // 1) restauration cloud → SQLite (si premium)
    // 2) puis backup (merge “le plus récent gagne”, donc sans perte)
    void (async () => {
      await flushPendingBookDeletesToSupabase();
      await restoreBooksFromSupabaseIfPremium();
      await backupBooksToSupabaseIfPremium();
      await warmSelectedChildIdFromStorage();
      hydrateTabScreensFromSqliteSync();
      await flushPendingCloudUploadsOnce();
      await hydrateTabScreensFromLocal();
      DeviceEventEmitter.emit('petitmo:memories-invalidate');
    })();
  }, [isAuthReady]);

  if (!isAuthReady) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={THEME.accent} />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PendingMediaUploadsProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen name="create-child" />
        <Stack.Screen name="edit-child" />
        <Stack.Screen name="parent-space" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="write" />
        <Stack.Screen name="camera" />
        <Stack.Screen name="record-voice" />
        <Stack.Screen name="import-media" />
        <Stack.Screen name="edit-photo" />
        <Stack.Screen
          name="memory-viewer"
          options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen name="memory-view" />
        <Stack.Screen name="book-preview" />
        <Stack.Screen name="book-order" />
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.bgScreen,
  },
});
