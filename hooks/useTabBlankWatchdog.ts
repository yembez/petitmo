import { useEffect, useRef } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useCallback } from 'react';
import {
  recordTabBlur,
  recordTabFocus,
  reportTabPaint,
  type MainTabWatchName,
  type TabPaintReason,
} from '@/lib/tabBlankWatchdog';

type PaintInput = {
  blank: boolean;
  reason: TabPaintReason;
  detail?: string;
};

/**
 * Branche un onglet au watchdog écran blanc (trail + Sentry si stuck).
 */
export function useTabBlankWatchdog(tab: MainTabWatchName, paint: PaintInput): void {
  const focused = useIsFocused();
  const paintRef = useRef(paint);
  paintRef.current = paint;

  useFocusEffect(
    useCallback(() => {
      recordTabFocus(tab);
      const p = paintRef.current;
      reportTabPaint({
        tab,
        focused: true,
        blank: p.blank,
        reason: p.reason,
        detail: p.detail,
      });
      return () => {
        recordTabBlur(tab);
      };
    }, [tab]),
  );

  useEffect(() => {
    reportTabPaint({
      tab,
      focused,
      blank: paint.blank,
      reason: paint.reason,
      detail: paint.detail,
    });
  }, [tab, focused, paint.blank, paint.reason, paint.detail]);
}
