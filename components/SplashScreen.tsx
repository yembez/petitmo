/**
 * SplashScreen.tsx
 * ────────────────
 * Wrapper qui :
 *   1. Cache le splash natif Expo dès que l'app est prête
 *   2. Joue l'animation SplashAnimation par-dessus
 *   3. Laisse passer les enfants (l'app) une fois l'animation terminée
 *
 * Usage dans app/_layout.tsx :
 *
 *   import SplashScreen from '@/components/SplashScreen'
 *
 *   export default function RootLayout() {
 *     return (
 *       <SplashScreen>
 *         <Stack />
 *       </SplashScreen>
 *     )
 *   }
 *
 * Dépendance :
 *   npx expo install expo-splash-screen
 */

import React, { useState, useEffect, useCallback } from 'react'
import { View, StyleSheet } from 'react-native'
import * as ExpoSplashScreen from 'expo-splash-screen'
import SplashAnimation from './SplashAnimation'

// Empêche le splash natif de disparaître automatiquement
ExpoSplashScreen.preventAutoHideAsync()

interface Props {
  children: React.ReactNode
}

export default function SplashScreen({ children }: Props) {
  const [appReady, setAppReady] = useState(false)
  const [animationDone, setAnimationDone] = useState(false)
  const [showAnimation, setShowAnimation] = useState(false)

  // Simule le chargement de l'app (fonts, data, auth…)
  // Remplace ce useEffect par ton vrai chargement
  useEffect(() => {
    async function prepare() {
      try {
        // ── Ici : charge tes fonts, ta session Supabase, SQLite, etc. ──
        // Exemple :
        //   await Font.loadAsync({ 'EB-Garamond': require('../assets/fonts/EBGaramond-Italic.ttf') })
        //   await supabase.auth.getSession()

        // Petite pause minimum pour que l'animation ait le temps de se lancer
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (e) {
        console.warn('Erreur au chargement initial :', e)
      } finally {
        setAppReady(true)
      }
    }

    prepare()
  }, [])

  // Dès que l'app est prête, on cache le splash natif et on lance l'animation
  const onLayoutRootView = useCallback(async () => {
    if (appReady) {
      await ExpoSplashScreen.hideAsync()
      setShowAnimation(true)
    }
  }, [appReady])

  // Callback quand l'animation est terminée
  const handleAnimationFinished = useCallback(() => {
    setAnimationDone(true)
  }, [])

  if (!appReady) return null

  return (
    <View style={styles.container} onLayout={onLayoutRootView}>
      {/* L'app en dessous (préchargée mais invisible pendant l'animation) */}
      <View style={styles.content} pointerEvents={animationDone ? 'auto' : 'none'}>
        {children}
      </View>

      {/* Animation par-dessus, en absolute */}
      {showAnimation && !animationDone && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <SplashAnimation onFinished={handleAnimationFinished} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
})
