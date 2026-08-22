import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Image,
  type LayoutChangeEvent,
  type ImageSourcePropType,
} from 'react-native';
import { Scissors } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';

const FILMSTRIP_SLOTS = 10;
const TRIM_ACCENT = THEME.brandCtaOrange;
const DIM_OVERLAY = 'rgba(0,0,0,0.45)';

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

function quantizeSec(t: number): number {
  return Math.round(Math.max(0, t) * 1000) / 1000;
}

export type VideoTrimEditorValue = {
  startSec: number;
  endSec: number;
};

function TrimHandleKnob({
  knobR,
  panHandlers,
  a11yLabel,
}: {
  knobR: number;
  panHandlers: object;
  a11yLabel: string;
}) {
  return (
    <View
      style={[
        styles.knob,
        {
          width: knobR * 2,
          height: knobR * 2,
          borderRadius: knobR,
        },
      ]}
      {...panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.knobGrip} />
      <View style={styles.knobGrip} />
      <View style={styles.knobGrip} />
    </View>
  );
}

export const VideoTrimEditor = memo(function VideoTrimEditor(props: {
  durationSec: number;
  value: VideoTrimEditorValue;
  maxClipSec: number;
  onChange: (v: VideoTrimEditorValue) => void;
  filmstripUris?: string[];
  title: string;
  subtitle: string;
  handleStartA11y: string;
  handleEndA11y: string;
  handleRangeA11y: string;
  onDragActiveChange?: (active: boolean) => void;
}) {
  const knobR = scale(15);
  const durationTotal = Math.max(0, props.durationSec);
  const maxClip = Math.max(1, props.maxClipSec);
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  const trackWinRef = useRef({ left: 0, width: 0 });
  const trackMeasureRef = useRef<View>(null);
  const durationTotalRef = useRef(0);
  const dragActiveRef = useRef(false);
  const onDragActiveChangeRef = useRef(props.onDragActiveChange);
  onDragActiveChangeRef.current = props.onDragActiveChange;

  const setDragActive = useCallback((active: boolean) => {
    if (dragActiveRef.current === active) return;
    dragActiveRef.current = active;
    onDragActiveChangeRef.current?.(active);
  }, []);

  useEffect(() => {
    return () => {
      if (dragActiveRef.current) {
        dragActiveRef.current = false;
        onDragActiveChangeRef.current?.(false);
      }
    };
  }, []);

  const clamp = useCallback(
    (start: number, end: number): VideoTrimEditorValue => {
      let s = Math.max(0, Math.min(durationTotal, start));
      let e = Math.max(0, Math.min(durationTotal, end));
      if (e < s) e = s;
      const minLen = 1;
      if (e - s < minLen) {
        e = Math.min(durationTotal, s + minLen);
      }
      if (e - s > maxClip) {
        e = s + maxClip;
        if (e > durationTotal) {
          e = durationTotal;
          s = Math.max(0, e - maxClip);
        }
      }
      return { startSec: quantizeSec(s), endSec: quantizeSec(e) };
    },
    [durationTotal, maxClip],
  );

  const normalized = useMemo(
    () => clamp(props.value.startSec, props.value.endSec),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.value.startSec, props.value.endSec, clamp],
  );

  const pxForSec = useMemo(() => {
    if (durationTotal <= 0 || trackW <= 0) return 0;
    return trackW / durationTotal;
  }, [durationTotal, trackW]);

  const onLayoutTrack = useCallback((e: LayoutChangeEvent) => {
    const tw = Math.max(0, Math.floor(e.nativeEvent.layout.width));
    trackWRef.current = tw;
    setTrackW(tw);
    trackMeasureRef.current?.measureInWindow((x, _y, mw) => {
      const width = tw > 0 ? tw : Math.max(0, Math.floor(mw));
      trackWinRef.current = { left: x, width };
    });
  }, []);

  durationTotalRef.current = durationTotal;

  const syncTrackFromWindowRef = useRef(() => {});
  syncTrackFromWindowRef.current = () => {
    trackMeasureRef.current?.measureInWindow((x, _y, w) => {
      const tw = trackWRef.current;
      const width = tw > 0 ? tw : Math.max(0, Math.floor(w));
      trackWinRef.current = { left: x, width };
    });
  };

  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const clampRef = useRef(clamp);
  clampRef.current = clamp;
  const metricsRef = useRef({ trackW: 0, pxForSec: 0, startSec: 0, endSec: 0 });
  metricsRef.current = {
    trackW,
    pxForSec,
    startSec: normalized.startSec,
    endSec: normalized.endSec,
  };

  const pageXToSecRef = useRef((_pageX: number): number | null => null);
  pageXToSecRef.current = (pageX: number): number | null => {
    const tw = trackWinRef.current;
    const m = metricsRef.current;
    const w = tw.width > 0 ? tw.width : m.trackW;
    const dur = durationTotalRef.current;
    if (w <= 0 || dur <= 0) return null;
    let rel = pageX - tw.left;
    rel = Math.max(0, Math.min(w, rel));
    return (rel / w) * dur;
  };

  const setDragActiveRef = useRef(setDragActive);
  setDragActiveRef.current = setDragActive;

  const rangeDragRef = useRef<{ initialStart: number; initialEnd: number; anchorSec: number } | null>(
    null,
  );

  const makeHandleResponder = (edge: 'start' | 'end') => {
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: evt => {
        setDragActiveRef.current(true);
        const pageX = evt.nativeEvent.pageX;
        const apply = () => {
          syncTrackFromWindowRef.current();
          const sec = pageXToSecRef.current(pageX);
          const m = metricsRef.current;
          if (sec != null && m.trackW > 0) {
            if (edge === 'start') {
              onChangeRef.current(clampRef.current(sec, m.endSec));
            } else {
              onChangeRef.current(clampRef.current(m.startSec, sec));
            }
          }
        };
        apply();
        requestAnimationFrame(apply);
      },
      onPanResponderMove: evt => {
        const m = metricsRef.current;
        const nextSec = pageXToSecRef.current(evt.nativeEvent.pageX);
        if (nextSec == null) return;
        if (edge === 'start') {
          onChangeRef.current(clampRef.current(nextSec, m.endSec));
        } else {
          onChangeRef.current(clampRef.current(m.startSec, nextSec));
        }
      },
      onPanResponderRelease: () => setDragActiveRef.current(false),
      onPanResponderTerminate: () => setDragActiveRef.current(false),
    });
  };

  const startResponderRef = useRef<ReturnType<typeof PanResponder.create> | undefined>(undefined);
  if (!startResponderRef.current) {
    startResponderRef.current = makeHandleResponder('start');
  }

  const endResponderRef = useRef<ReturnType<typeof PanResponder.create> | undefined>(undefined);
  if (!endResponderRef.current) {
    endResponderRef.current = makeHandleResponder('end');
  }

  const rangeResponderRef = useRef<ReturnType<typeof PanResponder.create> | undefined>(undefined);
  if (!rangeResponderRef.current) {
    rangeResponderRef.current = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2,
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: evt => {
        setDragActiveRef.current(true);
        const pageX = evt.nativeEvent.pageX;
        const apply = () => {
          syncTrackFromWindowRef.current();
          const m = metricsRef.current;
          const sec = pageXToSecRef.current(pageX);
          rangeDragRef.current = {
            initialStart: m.startSec,
            initialEnd: m.endSec,
            anchorSec: sec ?? m.startSec,
          };
        };
        apply();
        requestAnimationFrame(apply);
      },
      onPanResponderMove: evt => {
        const drag = rangeDragRef.current;
        if (!drag) return;
        const sec = pageXToSecRef.current(evt.nativeEvent.pageX);
        if (sec == null) return;
        const len = drag.initialEnd - drag.initialStart;
        const delta = sec - drag.anchorSec;
        let newStart = drag.initialStart + delta;
        let newEnd = newStart + len;
        const dur = durationTotalRef.current;
        if (newStart < 0) {
          newStart = 0;
          newEnd = len;
        }
        if (newEnd > dur) {
          newEnd = dur;
          newStart = Math.max(0, dur - len);
        }
        onChangeRef.current(clampRef.current(newStart, newEnd));
      },
      onPanResponderRelease: () => {
        rangeDragRef.current = null;
        setDragActiveRef.current(false);
      },
      onPanResponderTerminate: () => {
        rangeDragRef.current = null;
        setDragActiveRef.current(false);
      },
    });
  }

  const clipLen = Math.max(0, normalized.endSec - normalized.startSec);
  const startPx = Math.max(0, Math.min(trackW, normalized.startSec * pxForSec));
  const endPx = Math.max(0, Math.min(trackW, normalized.endSec * pxForSec));
  const selectionW = Math.max(0, endPx - startPx);

  const filmstrip = props.filmstripUris ?? [];
  const slots = useMemo(() => {
    const count = Math.max(FILMSTRIP_SLOTS, filmstrip.length || FILMSTRIP_SLOTS);
    return Array.from({ length: count }, (_, i) => filmstrip[i] ?? '');
  }, [filmstrip]);

  return (
    <View style={styles.root}>
      <View style={styles.titleRow}>
        <Scissors size={scale(22)} color={TRIM_ACCENT} strokeWidth={2.2} />
        <Text style={styles.title}>{props.title}</Text>
      </View>
      <Text style={styles.sub}>{props.subtitle}</Text>

      <View style={styles.timeRowEnds}>
        <Text style={styles.timeEnd}>{fmt(0)}</Text>
        <Text style={styles.timeEnd}>{fmt(durationTotal)}</Text>
      </View>

      <View ref={trackMeasureRef} style={styles.filmstripShell} onLayout={onLayoutTrack}>
        <View style={styles.filmstripRow}>
          {slots.map((uri, i) => {
            const tMid = ((i + 0.5) / slots.length) * durationTotal;
            const active = tMid >= normalized.startSec && tMid <= normalized.endSec;
            const source: ImageSourcePropType | undefined = uri ? { uri } : undefined;
            return (
              <View key={i} style={styles.filmstripCell}>
                {source ? (
                  <Image source={source} style={styles.filmstripThumb} resizeMode="cover" />
                ) : (
                  <View style={[styles.filmstripPlaceholder, active && styles.filmstripPlaceholderActive]} />
                )}
                {!active ? <View style={styles.filmstripDim} /> : null}
              </View>
            );
          })}
        </View>

        {trackW > 0 && durationTotal > 0 ? (
          <View style={styles.trimOverlay} pointerEvents="box-none">
            <View style={[styles.dimBand, { left: 0, width: startPx }]} pointerEvents="none" />
            <View
              style={[styles.dimBand, { left: endPx, width: Math.max(0, trackW - endPx) }]}
              pointerEvents="none"
            />
            <View style={[styles.selectionBorder, { left: startPx, width: selectionW }]} pointerEvents="none" />
            <View
              style={[styles.rangeDragZone, { left: startPx, width: selectionW }]}
              {...rangeResponderRef.current!.panHandlers}
              accessibilityRole="adjustable"
              accessibilityLabel={props.handleRangeA11y}
            />
            <View style={[styles.trimLine, { left: startPx - 1 }]} pointerEvents="none" />
            <View style={[styles.trimLine, { left: endPx - 1 }]} pointerEvents="none" />
            <View style={[styles.knobRow, { width: trackW }]}>
              <View style={[styles.knobWrap, { left: startPx - knobR }]}>
                <TrimHandleKnob
                  knobR={knobR}
                  panHandlers={startResponderRef.current!.panHandlers}
                  a11yLabel={props.handleStartA11y}
                />
              </View>
              <View style={[styles.knobWrap, { left: endPx - knobR }]}>
                <TrimHandleKnob
                  knobR={knobR}
                  panHandlers={endResponderRef.current!.panHandlers}
                  a11yLabel={props.handleEndA11y}
                />
              </View>
            </View>
          </View>
        ) : null}
      </View>

      <View style={styles.clipMetaRow}>
        <Text style={styles.clipBoundary}>{fmt(normalized.startSec)}</Text>
        <Text style={styles.clipDuration}>{fmt(clipLen)}</Text>
        <Text style={styles.clipBoundary}>{fmt(normalized.endSec)}</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { width: '100%', gap: scale(10) },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
  },
  title: {
    fontSize: scale(16),
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  sub: {
    fontSize: scale(13),
    color: THEME.textMuted,
    textAlign: 'center',
    lineHeight: scale(18),
  },
  timeRowEnds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scale(2),
  },
  timeEnd: {
    fontSize: scale(13),
    color: THEME.textMuted,
    fontVariant: ['tabular-nums'],
  },
  filmstripShell: {
    width: '100%',
    minHeight: scale(72),
    borderRadius: scale(10),
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
  },
  filmstripRow: {
    flexDirection: 'row',
    width: '100%',
    height: scale(56),
  },
  filmstripCell: {
    flex: 1,
    height: '100%',
    overflow: 'hidden',
  },
  filmstripThumb: {
    width: '100%',
    height: '100%',
  },
  filmstripPlaceholder: {
    flex: 1,
    backgroundColor: '#3A3A3C',
  },
  filmstripPlaceholderActive: {
    backgroundColor: '#4A4A4E',
  },
  filmstripDim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: DIM_OVERLAY,
  },
  trimOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  dimBand: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: DIM_OVERLAY,
  },
  selectionBorder: {
    position: 'absolute',
    top: 0,
    bottom: scale(34),
    borderWidth: scale(2),
    borderColor: TRIM_ACCENT,
    borderRadius: scale(4),
  },
  rangeDragZone: {
    position: 'absolute',
    top: 0,
    bottom: scale(34),
  },
  trimLine: {
    position: 'absolute',
    top: 0,
    bottom: scale(34),
    width: scale(2),
    backgroundColor: TRIM_ACCENT,
    borderRadius: scale(1),
  },
  knobRow: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: scale(34),
  },
  knobWrap: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
  },
  knob: {
    backgroundColor: THEME.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(3),
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: scale(6),
    shadowOffset: { width: 0, height: scale(2) },
    elevation: 3,
  },
  knobGrip: {
    width: scale(2),
    height: scale(11),
    borderRadius: scale(1),
    backgroundColor: '#FFFFFF',
  },
  clipMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(4),
  },
  clipBoundary: {
    fontSize: scale(13),
    color: THEME.textMuted,
    fontVariant: ['tabular-nums'],
    minWidth: scale(44),
  },
  clipDuration: {
    fontSize: scale(20),
    fontWeight: '700',
    color: THEME.textPrimary,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    flex: 1,
  },
});
