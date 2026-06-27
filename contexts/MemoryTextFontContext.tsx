import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useFonts } from 'expo-font';
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

/** Charge Roboto une fois pour les onglets (fil / favoris / livres) ; Charter = police système iOS. */
export function MemoryTextFontProvider({ children }: PropsWithChildren) {
  const [loaded] = useFonts(MEMORY_TEXT_FONT_SOURCES);
  const family = useMemo(
    () => (loaded ? MEMORY_TEXT_FONT_FAMILY : MEMORY_TEXT_FONT_FALLBACK),
    [loaded]
  );
  const editorialFamily = useMemo(
    () => (loaded ? MEMORY_EDITORIAL_FONT_FAMILY : MEMORY_EDITORIAL_FONT_FALLBACK),
    [loaded]
  );
  const editorialBoldFamily = useMemo(
    () => (loaded ? MEMORY_EDITORIAL_FONT_BOLD_FAMILY : MEMORY_EDITORIAL_FONT_FALLBACK),
    [loaded]
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

/** Typo éditoriale (Charter) des souvenirs texte du fil — titre + corps. */
export function useMemoryEditorialFont(): string {
  return useContext(MemoryEditorialFontContext);
}

/** Variante grasse (Charter Bold) — titre des souvenirs texte du fil. */
export function useMemoryEditorialBoldFont(): string {
  return useContext(MemoryEditorialBoldFontContext);
}

/** @deprecated Alias — même police que `useMemoryTextFont`. */
export function useFeedMemoryTextFont(): string {
  return useMemoryTextFont();
}
