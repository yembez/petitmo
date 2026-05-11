import { Platform } from 'react-native';
import { Audio } from 'expo-av';

/**
 * Configure la session audio pour la **lecture** (fil, viewer, lecteur vocal).
 * Sans `playsInSilentModeIOS`, iOS peut rester muet avec l’interrupteur silencieux.
 * Réappeler après un enregistrement (`allowsRecordingIOS: true`) pour rétablir l’écoute.
 */
export async function ensurePlaybackAudioForListening(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      ...(Platform.OS === 'android'
        ? {
            shouldDuckAndroid: true,
            playThroughEarpieceAndroid: false,
          }
        : {}),
    });
  } catch (e) {
    console.warn('[playbackAudio]', e);
  }
}
