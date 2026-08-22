import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder, type LayoutChangeEvent } from 'react-native';
import { Scissors } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';

const THUMB_R_DEFAULT = scale(12);
const WAVE_BARS_EDITOR = 46;
/** Orange vif type maquette (ondes actives / poignées) */
const TRIM_ACCENT = THEME.brandCtaOrange;
const BAR_GREY_OUT = '#E5E7EB';

function fmt(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, '0')}:${r.toString().padStart(2, '0')}`;
}

/** Évite le bruit float tout en gardant un déplacement fluide à l’écran. */
function quantizeSec(t: number): number {
  return Math.round(Math.max(0, t) * 1000) / 1000;
}

export type AudioTrimEditorValue = {
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
        styles.editorKnob,
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
      <View style={styles.editorKnobGrip} />
      <View style={styles.editorKnobGrip} />
      <View style={styles.editorKnobGrip} />
    </View>
  );
}

export const AudioTrimEditor = memo(function AudioTrimEditor(props: {
  durationSec: number;
  value: AudioTrimEditorValue;
  tier: 'free' | 'paid';
  onChange: (v: AudioTrimEditorValue) => void;
  /** Mise en page resserrée (ancienne piste fine). */
  compact?: boolean;
  /** Carte éditeur : barres, lignes de coupe, poignées type maquette. */
  presentation?: 'track' | 'editorCard';
  /** Indique un glissement actif sur une poignée (ex. désactiver le ScrollView parent). */
  onDragActiveChange?: (active: boolean) => void;
}) {
  const presentation = props.presentation ?? 'track';
  const thumbR = props.compact ? scale(10) : THUMB_R_DEFAULT;
  const knobR = scale(15);
  const durationTotal = Math.max(0, props.durationSec);
  const maxClip = props.tier === 'free' ? 60 : durationTotal;
  const [trackW, setTrackW] = useState(0);
  const trackWRef = useRef(0);
  /** Bord gauche de la piste dans l’écran + largeur (pour pageX → sec, sans dérive dx/clamp). */
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

  const barEnvelope = useMemo(
    () =>
      Array.from({ length: WAVE_BARS_EDITOR }, (_, i) => {
        const t = i * 0.47 + 0.35;
        return 0.25 + 0.75 * Math.abs(Math.sin(t)) * (0.55 + 0.45 * Math.abs(Math.sin(t * 1.15)));
      }),
    []
  );

  const clamp = useCallback(
    (start: number, end: number): AudioTrimEditorValue => {
      let s = Math.max(0, Math.min(durationTotal, start));
      let e = Math.max(0, Math.min(durationTotal, end));
      if (e < s) e = s;
      if (props.tier === 'free') {
        if (e - s > maxClip) {
          e = s + maxClip;
          if (e > durationTotal) {
            e = durationTotal;
            s = Math.max(0, e - maxClip);
          }
        }
      }
      return { startSec: quantizeSec(s), endSec: quantizeSec(e) };
    },
    [durationTotal, maxClip, props.tier]
  );

  const normalized = useMemo(
    () => clamp(props.value.startSec, props.value.endSec),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.value.startSec, props.value.endSec, clamp]
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

  /** Ne pas passer l’événement après un async (pooling RN : `nativeEvent` devient null). */
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

  const startResponderRef = useRef<ReturnType<typeof PanResponder.create> | undefined>(undefined);
  if (!startResponderRef.current) {
    startResponderRef.current = PanResponder.create({
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
            onChangeRef.current(clampRef.current(sec, m.endSec));
          }
        };
        apply();
        requestAnimationFrame(apply);
      },
      onPanResponderMove: evt => {
        const m = metricsRef.current;
        const nextSec = pageXToSecRef.current(evt.nativeEvent.pageX);
        if (nextSec == null) return;
        onChangeRef.current(clampRef.current(nextSec, m.endSec));
      },
      onPanResponderRelease: () => setDragActiveRef.current(false),
      onPanResponderTerminate: () => setDragActiveRef.current(false),
    });
  }

  const endResponderRef = useRef<ReturnType<typeof PanResponder.create> | undefined>(undefined);
  if (!endResponderRef.current) {
    endResponderRef.current = PanResponder.create({
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
            onChangeRef.current(clampRef.current(m.startSec, sec));
          }
        };
        apply();
        requestAnimationFrame(apply);
      },
      onPanResponderMove: evt => {
        const m = metricsRef.current;
        const nextSec = pageXToSecRef.current(evt.nativeEvent.pageX);
        if (nextSec == null) return;
        onChangeRef.current(clampRef.current(m.startSec, nextSec));
      },
      onPanResponderRelease: () => setDragActiveRef.current(false),
      onPanResponderTerminate: () => setDragActiveRef.current(false),
    });
  }

  const clipLen = Math.max(0, normalized.endSec - normalized.startSec);
  const startPx = Math.max(0, Math.min(trackW, normalized.startSec * pxForSec));
  const endPx = Math.max(0, Math.min(trackW, normalized.endSec * pxForSec));
  const c = props.compact;

  if (presentation === 'editorCard') {
    const barMaxH = scale(44);
    return (
      <View style={styles.editorRoot}>
        <View style={styles.editorTitleRow}>
          <Scissors size={scale(22)} color={TRIM_ACCENT} strokeWidth={2.2} />
          <Text style={styles.editorTitle}>Choisir le meilleur moment</Text>
        </View>
        <Text style={styles.editorSub}>
          {props.tier === 'free'
            ? 'En plan gratuit, ton extrait est limité à 1 minute.'
            : 'Coupez librement pour garder l’essentiel.'}
        </Text>

        <View style={styles.editorTimeRowEnds}>
          <Text style={styles.editorTimeEnd}>{fmt(0)}</Text>
          <Text style={styles.editorTimeEnd}>{fmt(durationTotal)}</Text>
        </View>

        <View ref={trackMeasureRef} style={styles.editorWaveShell} onLayout={onLayoutTrack}>
          <View style={styles.editorBarsRow}>
            {durationTotal > 0 &&
              barEnvelope.map((env, i) => {
                const tMid = ((i + 0.5) / WAVE_BARS_EDITOR) * durationTotal;
                const active = tMid >= normalized.startSec && tMid <= normalized.endSec;
                const h = barMaxH * env;
                return (
                  <View key={i} style={styles.editorBarCell}>
                    <View
                      style={[
                        styles.editorBar,
                        {
                          height: Math.max(scale(4), h),
                          backgroundColor: active ? TRIM_ACCENT : BAR_GREY_OUT,
                        },
                      ]}
                    />
                  </View>
                );
              })}
          </View>

          {trackW > 0 && durationTotal > 0 ? (
            <View style={styles.editorTrimOverlay} pointerEvents="box-none">
              <View style={[styles.editorTrimLine, { left: startPx - 1 }]} />
              <View style={[styles.editorTrimLine, { left: endPx - 1 }]} />
              <View style={[styles.editorKnobRow, { width: trackW }]}>
                <View style={[styles.editorKnobWrap, { left: startPx - knobR }]}>
                  <TrimHandleKnob
                    knobR={knobR}
                    panHandlers={startResponderRef.current!.panHandlers}
                    a11yLabel="Début"
                  />
                </View>
                <View style={[styles.editorKnobWrap, { left: endPx - knobR }]}>
                  <TrimHandleKnob
                    knobR={knobR}
                    panHandlers={endResponderRef.current!.panHandlers}
                    a11yLabel="Fin"
                  />
                </View>
              </View>
            </View>
          ) : null}
        </View>

        <Text style={styles.editorClipDuration}>{fmt(clipLen)}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, c && styles.rootCompact]}>
      <Text style={[styles.title, c && styles.titleCompact]}>Choisir le meilleur moment</Text>
      <Text style={[styles.sub, c && styles.subCompact]}>
        {props.tier === 'free'
          ? 'En plan gratuit, ton extrait est limité à 1 minute.'
          : 'Coupez librement pour garder l’essentiel.'}
      </Text>

      <View style={styles.timeRow}>
        <Text style={[styles.time, c && styles.timeCompact]}>{fmt(normalized.startSec)}</Text>
        <Text style={[styles.timeMid, c && styles.timeCompact]}>{fmt(clipLen)}</Text>
        <Text style={[styles.time, c && styles.timeCompact]}>{fmt(normalized.endSec)}</Text>
      </View>

      <View ref={trackMeasureRef} style={[styles.sliderWrap, c && styles.sliderWrapCompact]} onLayout={onLayoutTrack}>
        <View style={styles.track} pointerEvents="none" />
        <View
          style={[
            styles.selected,
            {
              left: startPx,
              width: Math.max(0, endPx - startPx),
            },
          ]}
          pointerEvents="none"
        />
        <View
          style={[
            styles.thumb,
            {
              left: startPx - thumbR,
              width: thumbR * 2,
              height: thumbR * 2,
              borderRadius: thumbR,
              marginTop: -thumbR,
            },
          ]}
          {...startResponderRef.current!.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="Début"
        />
        <View
          style={[
            styles.thumb,
            {
              left: endPx - thumbR,
              width: thumbR * 2,
              height: thumbR * 2,
              borderRadius: thumbR,
              marginTop: -thumbR,
            },
          ]}
          {...endResponderRef.current!.panHandlers}
          accessibilityRole="adjustable"
          accessibilityLabel="Fin"
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  editorRoot: { width: '100%', gap: scale(10) },
  editorTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
  },
  editorTitle: {
    fontSize: scale(16),
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  editorSub: {
    fontSize: scale(13),
    color: THEME.textMuted,
    textAlign: 'center',
    lineHeight: scale(18),
  },
  editorTimeRowEnds: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: scale(2),
  },
  editorTimeEnd: {
    fontSize: scale(13),
    color: THEME.textMuted,
    fontVariant: ['tabular-nums'],
  },
  editorWaveShell: {
    width: '100%',
    minHeight: scale(88),
    justifyContent: 'flex-end',
    paddingBottom: scale(8),
  },
  editorBarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    width: '100%',
    height: scale(48),
    paddingHorizontal: scale(2),
  },
  editorBarCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginHorizontal: scale(0.5),
  },
  editorBar: {
    width: '100%',
    maxWidth: scale(5),
    borderRadius: scale(2),
  },
  editorTrimOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  editorTrimLine: {
    position: 'absolute',
    top: scale(16),
    bottom: scale(46),
    width: scale(2),
    backgroundColor: TRIM_ACCENT,
    borderRadius: scale(1),
  },
  editorKnobRow: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: scale(34),
  },
  editorKnobWrap: {
    position: 'absolute',
    bottom: 0,
    alignItems: 'center',
  },
  editorKnob: {
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
  editorKnobGrip: {
    width: scale(2),
    height: scale(11),
    borderRadius: scale(1),
    backgroundColor: '#FFFFFF',
  },
  editorClipDuration: {
    fontSize: scale(17),
    fontWeight: '700',
    color: THEME.textPrimary,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
    marginTop: scale(2),
  },
  root: { width: '100%', gap: scale(10) },
  rootCompact: { gap: scale(4) },
  title: {
    fontSize: scale(16),
    fontWeight: '600',
    color: THEME.textPrimary,
    textAlign: 'center',
  },
  titleCompact: { fontSize: scale(14) },
  sub: { fontSize: scale(13), color: THEME.textMuted, textAlign: 'center' },
  subCompact: { fontSize: scale(11), lineHeight: scale(14) },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  time: { fontSize: scale(13), color: THEME.textMuted },
  timeMid: { fontSize: scale(13), color: THEME.textPrimary, fontWeight: '600' },
  timeCompact: { fontSize: scale(12) },
  sliderWrap: {
    width: '100%',
    paddingVertical: scale(14),
    height: scale(44),
    justifyContent: 'center',
  },
  sliderWrapCompact: {
    paddingVertical: scale(6),
    height: scale(36),
  },
  track: {
    width: '100%',
    height: scale(4),
    backgroundColor: 'rgba(0,0,0,0.12)',
    borderRadius: scale(999),
  },
  selected: {
    position: 'absolute',
    top: '50%',
    marginTop: -scale(2),
    height: scale(4),
    backgroundColor: THEME.brandCtaOrange,
    borderRadius: scale(999),
  },
  thumb: {
    position: 'absolute',
    top: '50%',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: THEME.brandCtaOrange,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
});
