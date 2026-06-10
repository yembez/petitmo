import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

type TabTransitionContextValue = {
  /** 1 = onglet suivant (glisse depuis la droite), -1 = précédent. */
  direction: number;
  setTabIndex: (index: number) => void;
};

const TabTransitionContext = createContext<TabTransitionContextValue | null>(null);

export function TabTransitionProvider({ children }: { children: ReactNode }) {
  const prevIndexRef = useRef(0);
  const [direction, setDirection] = useState(1);

  const setTabIndex = useCallback((index: number) => {
    const prev = prevIndexRef.current;
    if (index !== prev) {
      setDirection(index > prev ? 1 : -1);
      prevIndexRef.current = index;
    }
  }, []);

  const value = useMemo(
    () => ({ direction, setTabIndex }),
    [direction, setTabIndex],
  );

  return <TabTransitionContext.Provider value={value}>{children}</TabTransitionContext.Provider>;
}

export function useTabTransition(): TabTransitionContextValue {
  const ctx = useContext(TabTransitionContext);
  if (!ctx) {
    throw new Error('useTabTransition must be used within TabTransitionProvider');
  }
  return ctx;
}
