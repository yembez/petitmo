import * as Location from 'expo-location';

/**
 * Tente d’obtenir un libellé lisible (ville / région) pour le souvenir.
 * Retourne null si refus, erreur ou plateforme sans support.
 */
export async function getApproximateLocationLabel(): Promise<string | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const [geo] = await Location.reverseGeocodeAsync({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    });

    if (!geo) return null;

    /** Même règle que l’import EXIF : pas de région entre parenthèses dans le fil. */
    const place =
      geo.city ||
      geo.district ||
      geo.subregion ||
      geo.region ||
      geo.country ||
      null;
    return place ? place.trim() || null : null;
  } catch {
    return null;
  }
}
