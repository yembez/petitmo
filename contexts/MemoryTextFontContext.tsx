import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { useFonts } from 'expo-font';
import {
  MEMORY_TEXT_FONT_FALLBACK,
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_SOURCES,
} from '@/constants/memoryTextFont';

const MemoryTextFontContext = createContext<string>(MEMORY_TEXT_FONT_FALLBACK);

/** Charge Roboto une fois pour les onglets (fil / favoris / livres). */
export function MemoryTextFontProvider({ children }: PropsWithChildren) {
  const [loaded] = useFonts(MEMORY_TEXT_FONT_SOURCES);
  const family = useMemo(
    () => (loaded ? MEMORY_TEXT_FONT_FAMILY : MEMORY_TEXT_FONT_FALLBACK),
    [loaded]
  );
  return (
    <MemoryTextFontContext.Provider value={family}>{children}</MemoryTextFontContext.Provider>
  );
}

export function useMemoryTextFont(): string {
  return useContext(MemoryTextFontContext);
}

/** @deprecated Alias — même police que `useMemoryTextFont`. */
export function useFeedMemoryTextFont(): string {
  return useMemoryTextFont();
}
