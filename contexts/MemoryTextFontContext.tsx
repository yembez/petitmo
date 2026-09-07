import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useFonts } from 'expo-font';
import * as Font from 'expo-font';
import {
  MEMORY_EDITORIAL_FONT_BOLD_FAMILY,
  MEMORY_EDITORIAL_FONT_FALLBACK,
  MEMORY_EDITORIAL_FONT_FAMILY,
  MEMORY_TEXT_FONT_FALLBACK,
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_SOURCES,
} from '@/constants/memoryTextFont';

const MemoryTextFontContext = createContext<string>(MEMORY_TEXT_FONT_FALLBACK);
const MemoryEditorialFontContext = createContext<string>(MEMORY_EDITORIAL_FONT_FALLBACK);
const MemoryEditorialBoldFontContext = createContext<string>(MEMORY_EDITORIAL_FONT_FALLBACK);

function memoryFontsReady(loadedFromHook: boolean): boolean {
  return (
    loadedFromHook ||
    (Font.isLoaded('DMSans_400Regular') && Font.isLoaded('DMSans_600SemiBold'))
  );
}

/** Charge DM Sans une fois pour les onglets (souvent déjà au boot). */
export function MemoryTextFontProvider({ children }: PropsWithChildren) {
  const [loaded] = useFonts(MEMORY_TEXT_FONT_SOURCES);
  const ready = memoryFontsReady(loaded);
  const family = useMemo(
    () => (ready ? MEMORY_TEXT_FONT_FAMILY : MEMORY_TEXT_FONT_FALLBACK),
    [ready]
  );
  const editorialFamily = useMemo(
    () => (ready ? MEMORY_EDITORIAL_FONT_FAMILY : MEMORY_EDITORIAL_FONT_FALLBACK),
    [ready]
  );
  const editorialBoldFamily = useMemo(
    () => (ready ? MEMORY_EDITORIAL_FONT_BOLD_FAMILY : MEMORY_EDITORIAL_FONT_FALLBACK),
    [ready]
  );
  return (
    <MemoryTextFontContext.Provider value={family}>
      <MemoryEditorialFontContext.Provider value={editorialFamily}>
        <MemoryEditorialBoldFontContext.Provider value={editorialBoldFamily}>
          {children}
        </MemoryEditorialBoldFontContext.Provider>
      </MemoryEditorialFontContext.Provider>
    </MemoryTextFontContext.Provider>
  );
}

export function useMemoryTextFont(): string {
  return useContext(MemoryTextFontContext);
}

/** Typo DM Sans des souvenirs texte du fil — titre + corps + légendes. */
export function useMemoryEditorialFont(): string {
  return useContext(MemoryEditorialFontContext);
}

/** Variante semi-bold — titre des souvenirs texte du fil. */
export function useMemoryEditorialBoldFont(): string {
  return useContext(MemoryEditorialBoldFontContext);
}

/** @deprecated Alias — même police que `useMemoryTextFont`. */
export function useFeedMemoryTextFont(): string {
  return useMemoryTextFont();
}
