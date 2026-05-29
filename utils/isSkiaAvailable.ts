import { NativeModules, Platform } from 'react-native';

let cached: boolean | null = null;

/** `true` seulement si le module natif Skia est lié (build dev client / binaire avec RNSkia). */
export function isSkiaAvailable(): boolean {
  if (cached !== null) return cached;
  if (Platform.OS === 'web') {
    cached = false;
    return false;
  }
  try {
    cached = NativeModules.RNSkiaModule != null;
  } catch {
    cached = false;
  }
  return cached;
}
