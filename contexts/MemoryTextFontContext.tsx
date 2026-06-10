import { createContext, useContext, type PropsWithChildren } from 'react';
import { useFonts } from 'expo-font';
import {
  MEMORY_TEXT_FONT_FALLBACK,
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_SOURCES,
} from '@/constants/memoryTextFont';

const MemoryTextFontContext = createContext<string>(MEMORY_TEXT_FONT_FALLBACK);

export function MemoryTextFontProvider({ children }: PropsWithChildren) {
  const [loaded] = useFonts(MEMORY_TEXT_FONT_SOURCES);
  const family = loaded ? MEMORY_TEXT_FONT_FAMILY : MEMORY_TEXT_FONT_FALLBACK;
  return (
    <MemoryTextFontContext.Provider value={family}>{children}</MemoryTextFontContext.Provider>
  );
}

/** Police Garamond des souvenirs texte (EB Garamond ou GLC si configuré). */
export function useMemoryTextFont(): string {
  return useContext(MemoryTextFontContext);
}
