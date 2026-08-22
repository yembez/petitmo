import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Audio } from 'expo-av';
import { BlurView } from 'expo-blur';
import { ensurePlaybackAudioForListening } from '@/lib/playbackAudioMode';
import { Play, Pause } from 'lucide-react-native';
import Svg, { Defs, LinearGradient as SvgLinearGradient, Rect, Stop } from 'react-native-svg';
import { scale } from '@/utils/responsive';
import { formatDuration } from '@/utils/date';
import { THEME } from '@/constants/theme';
import { BRAND_ACTION_GRADIENT } from '@/constants/captureScreenPalette';

const PLAY = scale(50);
const STACK = scale(104);
/** Fil sans vignette : disque play compact, aligné sur l’onde. */
const PLAY_FEED = scale(44);
const BAR_COUNT = 42;
/** Demi-hauteur de l’onde (barres centrées sur l’axe) */
const WAVE_HALF = scale(18);
/** Onde en lecture (portion déjà jouée) — rouge charte */
const WAVE_PLAYING = THEME.brandPrimary;
const RING = 'rgba(253, 119, 100, 0.28)';
const BAR_GAP = scale(2);

interface AudioPlayerProps {
  uri: string;
  duration?: number;
  /**
   * Début de l’extrait (secondes) quand le fichier contient la prise complète.
   * Non null ⇒ lecture uniquement sur [playbackStartSec, playbackStartSec + duration].
   */
  playbackStartSec?: number | null;
  /** Avec photo de fond : play à gauche + onde sur la même ligne en bas */
  variant?: 'default' | 'coverBottom' | 'feedRow';
  /** Icônes play / pause (défaut blanc). */
  controlIconColor?: string;
  /** Réduit les marges internes pour coller play + onde au bas du visuel (ex. fil avec photo). */
  coverFlushBottom?: boolean;
  /** Fil : liseré noir fin autour du disque play / pause. */
  feedPlayDiscOutline?: boolean;
  /** Fil : désactive le flou temps réel (BlurView) du disque play pour un scroll fluide. */
  disableBlurDisc?: boolean;
}

function GlassPlayDisc({
  size,
  iconSize,
  isPlaying,
  controlIconColor,
  onPress,
  outline,
  disableBlur,
}: {
  size: number;
  iconSize: number;
  isPlaying: boolean;
  controlIconColor: string;
  onPress: () => void;
  outline?: boolean;
  /** Fil : évite le flou temps réel (BlurView) qui saccade le scroll — fallback verre statique. */
  disableBlur?: boolean;
}) {
  const icon = isPlaying ? (
    <Pause size={iconSize} color={controlIconColor} fill={controlIconColor} strokeWidth={0} />
  ) : (
    <View style={{ marginLeft: scale(size >= PLAY ? 4 : 3) }}>
      <Play size={iconSize} color={controlIconColor} fill={controlIconColor} strokeWidth={0} />
    </View>
  );

  return (
    <TouchableOpacity
      style={[
        styles.glassPlayOuter,
        outline && styles.glassPlayOuterOutline,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      {Platform.OS === 'ios' && !disableBlur ? (
        <BlurView intensity={72} tint="light" style={StyleSheet.absoluteFillObject}>
          <View style={styles.glassPlaySheen} />
          <View style={styles.glassPlayContent}>{icon}</View>
        </BlurView>
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.glassPlayFallback]}>
          <View style={styles.glassPlaySheen} />
          <View style={styles.glassPlayContent}>{icon}</View>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function AudioPlayer({
  uri,
  duration,
  playbackStartSec,
  variant = 'default',
  controlIconColor = '#FFFFFF',
  coverFlushBottom = false,
  feedPlayDiscOutline = false,
  disableBlurDisc = false,
}: AudioPlayerProps) {
  const waveGradId = `audioWaveGrad-${useId().replace(/:/g, '')}`;
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);
  /** Progression affichée du clip (0–1), extrapolée entre les ticks expo-av pour un défilement fluide */
  const [displayFrac, setDisplayFrac] = useState(0);
  const anchorPosRef = useRef(0);
  const anchorTimeRef = useRef(Date.now());
  const durationRef = useRef(Math.max(duration || 0, 0.001));
  /** Lecture terminée : le prochain « play » doit reprendre au début de l’extrait */
  const finishedRef = useRef(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const clipWindowRef = useRef({
    active: false,
    start: 0,
    end: 0,
    len: 0,
  });

  const clipWindow =
    playbackStartSec != null && typeof duration === 'number' && duration > 0.01;
  const clipStart = clipWindow ? playbackStartSec! : 0;
  const clipLen = clipWindow ? duration! : 0;
  const clipEnd = clipStart + clipLen;
  clipWindowRef.current = { active: clipWindow, start: clipStart, end: clipEnd, len: clipLen };

  const positionDisplay = clipWindow
    ? Math.max(0, Math.min(clipLen, position - clipStart))
    : position;
  const totalDisplay = clipWindow ? clipLen : totalDuration;

  const barHeights = useMemo(
    () =>
      Array.from({ length: BAR_COUNT }, (_, i) => {
        const t = i * 0.38 + 0.7;
        return 0.22 + 0.78 * Math.abs(Math.sin(t)) * (0.65 + 0.35 * Math.abs(Math.sin(t * 1.3)));
      }),
    []
  );

  const [waveW, setWaveW] = useState(0);
  const waveHalf = variant === 'feedRow' ? scale(12) : WAVE_HALF;
  const waveH = waveHalf * 2;
  const barW =
    waveW > 1 ? Math.max(scale(2), (waveW - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT) : 0;
  const maxBarH = Math.max(scale(4), waveH - scale(2));

  useEffect(() => {
    anchorPosRef.current = positionDisplay;
    anchorTimeRef.current = Date.now();
    durationRef.current = Math.max(totalDisplay, 0.001);
    if (!isPlaying) {
      setDisplayFrac(totalDisplay > 0 ? Math.min(1, Math.max(0, positionDisplay / totalDisplay)) : 0);
    }
  }, [position, positionDisplay, totalDisplay, totalDuration, isPlaying]);

  useEffect(() => {
    if (!isPlaying) return;
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const dt = (now - anchorTimeRef.current) / 1000;
      const dur = durationRef.current;
      let p = anchorPosRef.current + dt;
      if (p > dur) p = dur;
      setDisplayFrac(dur > 0 ? p / dur : 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  useEffect(() => {
    soundRef.current = sound;
  }, [sound]);

  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  const loadSound = async () => {
    try {
      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false },
        onPlaybackStatusUpdate
      );
      soundRef.current = newSound;
      setSound(newSound);
      const w = clipWindowRef.current;
      if (w.active) {
        await newSound.setPositionAsync(Math.floor(w.start * 1000));
        setPosition(w.start);
        setTotalDuration(w.len);
      }
      return newSound;
    } catch (error) {
      console.error('Error loading sound:', error);
      return null;
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (!status.isLoaded) return;

    const w = clipWindowRef.current;

    if (w.active) {
      if (status.isPlaying) {
        finishedRef.current = false;
      }
      const posSec = status.positionMillis / 1000;
      if (status.isPlaying && posSec >= w.end - 0.08) {
        finishedRef.current = true;
        void soundRef.current?.pauseAsync();
        void soundRef.current?.setPositionAsync(Math.floor(w.start * 1000));
        setIsPlaying(false);
        setPosition(w.start);
        setDisplayFrac(0);
        anchorPosRef.current = 0;
        anchorTimeRef.current = Date.now();
        return;
      }
      setPosition(posSec);
      setTotalDuration(w.len);
      setIsPlaying(status.isPlaying);

      if (status.didJustFinish) {
        finishedRef.current = true;
        setIsPlaying(false);
        void soundRef.current?.setPositionAsync(Math.floor(w.start * 1000));
        setPosition(w.start);
        setDisplayFrac(0);
        anchorPosRef.current = 0;
        anchorTimeRef.current = Date.now();
      }
      return;
    }

    if (status.isPlaying) {
      finishedRef.current = false;
    }
    setPosition(status.positionMillis / 1000);
    setTotalDuration(status.durationMillis ? status.durationMillis / 1000 : duration || 0);
    setIsPlaying(status.isPlaying);

    if (status.didJustFinish) {
      finishedRef.current = true;
      setIsPlaying(false);
      setPosition(0);
      setDisplayFrac(0);
      anchorPosRef.current = 0;
      anchorTimeRef.current = Date.now();
    }
  };

  const togglePlayPause = async () => {
    try {
      let currentSound = sound;

      if (!currentSound) {
        currentSound = await loadSound();
        if (!currentSound) return;
      }

      if (isPlaying) {
        await currentSound.pauseAsync();
        return;
      }

      await ensurePlaybackAudioForListening();

      const st = await currentSound.getStatusAsync();
      if (!st.isLoaded) return;

      const w = clipWindowRef.current;
      if (w.active) {
        const posSec = st.positionMillis / 1000;
        if (finishedRef.current || posSec < w.start - 0.02 || posSec >= w.end - 0.05) {
          finishedRef.current = false;
          await currentSound.setPositionAsync(Math.floor(w.start * 1000));
          setPosition(w.start);
          setDisplayFrac(0);
          anchorPosRef.current = 0;
          anchorTimeRef.current = Date.now();
        }
      } else if (finishedRef.current) {
        finishedRef.current = false;
        await currentSound.setPositionAsync(0);
        setPosition(0);
        setDisplayFrac(0);
        anchorPosRef.current = 0;
        anchorTimeRef.current = Date.now();
      }

      await currentSound.playAsync();
    } catch (error) {
      console.error('Error toggling play/pause:', error);
    }
  };

  const stack = STACK;
  const ringSizes = [stack * 0.92, stack * 0.76, stack * 0.6];
  const feedRowH = Math.max(PLAY_FEED, waveH);

  /** Bas du bouton aligné sur le bas de l’onde (fil avec photo), sans grande pile décorative. */
  const PLAY_FLUSH = scale(54);
  const playFeedEl = (
    <GlassPlayDisc
      size={PLAY_FEED}
      iconSize={scale(22)}
      isPlaying={isPlaying}
      controlIconColor={controlIconColor}
      onPress={togglePlayPause}
      outline={feedPlayDiscOutline}
      disableBlur={disableBlurDisc}
    />
  );
  const playFlushEl = (
    <GlassPlayDisc
      size={PLAY_FLUSH}
      iconSize={scale(26)}
      isPlaying={isPlaying}
      controlIconColor={controlIconColor}
      onPress={togglePlayPause}
      outline={feedPlayDiscOutline}
      disableBlur={disableBlurDisc}
    />
  );

  const playStackEl = (
    <View style={[styles.playStack, variant === 'coverBottom' && styles.playStackCover, { width: stack, height: stack }]}>
      {ringSizes.map((size, idx) => (
        <View
          key={idx}
          style={[
            styles.ring,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              top: (stack - size) / 2,
              left: (stack - size) / 2,
            },
          ]}
        />
      ))}
      <View
        style={{
          position: 'absolute',
          top: (stack - PLAY) / 2,
          left: (stack - PLAY) / 2,
        }}
      >
        <GlassPlayDisc
          size={PLAY}
          iconSize={scale(22)}
          isPlaying={isPlaying}
          controlIconColor={controlIconColor}
          onPress={togglePlayPause}
          outline={feedPlayDiscOutline}
          disableBlur={disableBlurDisc}
        />
      </View>
    </View>
  );

  const waveformEl = (
    <View
      style={[
        styles.waveform,
        (variant === 'coverBottom' || variant === 'feedRow') && styles.waveformCover,
        variant === 'feedRow' && { height: waveH },
      ]}
      onLayout={e => setWaveW(Math.max(0, Math.floor(e.nativeEvent.layout.width)))}
    >
      {waveW > 1 && barW > 0 ? (
        <Svg width={waveW} height={waveH} viewBox={`0 0 ${waveW} ${waveH}`}>
          <Defs>
            <SvgLinearGradient id={waveGradId} x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={BRAND_ACTION_GRADIENT[0]} />
              <Stop offset="1" stopColor={BRAND_ACTION_GRADIENT[1]} />
            </SvgLinearGradient>
          </Defs>
          {barHeights.map((amp, i) => {
            const h = Math.max(scale(3), amp * maxBarH);
            const x = i * (barW + BAR_GAP);
            const y = (waveH - h) / 2;
            const isPlayed = isPlaying && displayFrac > 0 && (i + 1) / BAR_COUNT <= displayFrac;
            return (
              <Rect
                key={i}
                x={x}
                y={y}
                width={barW}
                height={h}
                rx={Math.min(barW / 2, scale(1.5))}
                fill={isPlayed ? WAVE_PLAYING : `url(#${waveGradId})`}
              />
            );
          })}
        </Svg>
      ) : (
        <View style={{ height: waveH }} />
      )}
    </View>
  );

  const timeRowEl = (
    <View
      style={[
        styles.timeRow,
        variant === 'coverBottom' && styles.timeRowCover,
        variant === 'coverBottom' && coverFlushBottom && styles.timeRowCoverFlush,
        variant === 'feedRow' && styles.timeRowFeedRow,
      ]}
    >
      <Text style={styles.timeText}>{formatDuration(Math.floor(positionDisplay))}</Text>
      <View style={styles.timeDivider} />
      <Text style={styles.timeText}>{formatDuration(Math.floor(totalDisplay))}</Text>
    </View>
  );

  if (variant === 'coverBottom') {
    return (
      <View style={[styles.containerCover, coverFlushBottom && styles.containerCoverFlush]}>
        <View style={[styles.coverBottomRow, coverFlushBottom && styles.coverBottomRowFlush]}>
          {coverFlushBottom ? playFlushEl : playStackEl}
          {waveformEl}
        </View>
        {timeRowEl}
      </View>
    );
  }

  if (variant === 'feedRow') {
    return (
      <View style={styles.containerFeedRow}>
        <View style={[styles.feedRow, { minHeight: feedRowH }]}>
          <View style={[styles.feedPlaySlot, { height: feedRowH, width: PLAY_FEED }]}>
            {playFeedEl}
          </View>
          {waveformEl}
        </View>
        {timeRowEl}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {playStackEl}
      {waveformEl}
      {timeRowEl}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    width: '100%',
    paddingVertical: scale(8),
    paddingHorizontal: scale(4),
    backgroundColor: 'transparent',
  },
  containerCover: {
    width: '100%',
    paddingVertical: scale(4),
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
  },
  containerCoverFlush: {
    paddingTop: 0,
    paddingBottom: 0,
  },
  containerFeedRow: {
    width: '100%',
    paddingVertical: 0,
    paddingHorizontal: 0,
    backgroundColor: 'transparent',
  },
  feedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: scale(10),
  },
  feedPlaySlot: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coverBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: scale(10),
  },
  /** Play + onde alignés sur le bas de la ligne (fil photo pleine) */
  coverBottomRowFlush: {
    alignItems: 'flex-end',
  },
  playStack: {
    marginBottom: scale(16),
    position: 'relative',
  },
  playStackCover: {
    marginBottom: 0,
    flexShrink: 0,
  },
  ring: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: RING,
    backgroundColor: 'transparent',
  },
  glassPlayOuter: {
    flexShrink: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255, 255, 255, 0.78)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: scale(2) },
        shadowOpacity: 0.12,
        shadowRadius: scale(4),
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  glassPlayOuterOutline: {
    borderColor: '#000000',
    borderWidth: StyleSheet.hairlineWidth,
  },
  glassPlayFallback: {
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
  },
  glassPlaySheen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
  },
  glassPlayContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: WAVE_HALF * 2,
    width: '100%',
    marginBottom: scale(12),
    paddingHorizontal: scale(2),
  },
  waveformCover: {
    flex: 1,
    minWidth: 0,
    marginBottom: 0,
  },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(10),
    width: '100%',
  },
  timeRowCover: {
    marginTop: scale(6),
    paddingHorizontal: scale(2),
  },
  timeRowCoverFlush: {
    marginTop: scale(2),
    paddingBottom: 0,
  },
  timeRowFeedRow: {
    marginTop: scale(4),
    paddingHorizontal: 0,
  },
  timeText: {
    fontSize: scale(12),
    color: '#9CA3AF',
    letterSpacing: 0.2,
  },
  timeDivider: {
    flex: 1,
    maxWidth: scale(120),
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#D1D5DB',
  },
});
