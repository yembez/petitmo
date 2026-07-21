import { getLocales } from 'expo-localization';

/** Région appareil (ex. US) — utile plus tard pour pays / devise. */
export function deviceRegionCode(): string | undefined {
  return getLocales()[0]?.regionCode ?? undefined;
}
