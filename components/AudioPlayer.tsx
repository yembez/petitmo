import React, { useState, useEffect, useMemo, useRef, useId, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Audio } from 'expo-av';
import { BlurView } from 'expo-blur';
import { ensurePlaybackAudioForListening } from '@/lib/playbackAudioMode';
import {
  claimAudioPlayback,
  registerAudioPlayer,
  releaseAudioPlayback,
} from '@/lib/audioPlaybackCoordinator';
import { Play, Pause } from 'lucide-react-native';
import Svg, { Rect } from 'react-native-svg';
import { scale } from '@/utils/responsive';
import { formatDuration } from '@/utils/date';
import { organicWaveBars } from '@/utils/organicWaveBars';
import { fitWavePeaksToDisplayRange, parseVoiceWavePeaks, resampleWavePeaks } from '@/utils/voiceWavePeaks';

const PLAY = scale(50);
const STACK = scale(104);
/** Fil : disque play compact, centre = axe de la wave. */
const PLAY_FEED = scale(34);
/**
 * Immersif / défaut : needles type D (traits un cran plus épais que v2).
 * Moins de barres → chaque trait un peu plus large.
 */
const BAR_COUNT = 72;
/** Fil : needles View (pas SVG) — scroll fluide sur vocal + cover. */
const FEED_BAR_COUNT = 56;
/** Demi-hauteur immersif / défaut. */
const WAVE_HALF = scale(32);
/** Demi-hauteur fil. */
const WAVE_HALF_FEED = scale(19);
/** Portion lue — noir charte (fond clair). */
const WAVE_PLAYING_INK = '#1C1C1E';
/** Non lu — gris visible (fond clair). */
const WAVE_IDLE_INK = '#AEAEB2';
/** Immersif sombre : lu = blanc, non lu = gris clair. */
const WAVE_PLAYING_ON_DARK = '#FFFFFF';
const WAVE_IDLE_ON_DARK = 'rgba(255, 255, 255, 0.42)';
const RING = 'rgba(28, 28, 30, 0.22)';
const BAR_GAP = scale(1);

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
  /** Mode plus compact (utilisé en vue immersive audio). */
  compactPlayWave?: boolean;
  /** Fil : liseré noir fin autour du disque play / pause. */
  feedPlayDiscOutline?: boolean;
  /** Fil : désactive le flou temps réel (BlurView) du disque play pour un scroll fluide. */
  disableBlurDisc?: boolean;
  /**
   * Fil : ne pas `createAsync` au mount — charge au 1er play seulement
   * (évite le décodage audio hors viewport pendant le scroll).
   */
  deferLoadUntilPlay?: boolean;
  /**
   * Palette onde : `ink` = noir/gris (fil, fond clair) ;
   * `onDark` = blanc/gris (immersif sombre).
   */
  wavePalette?: 'ink' | 'onDark';
  /** Pics metering persistés (0..1) — sinon onde organique de repli. */
  wavePeaks?: number[] | string | null;
}

function GlassPlayDisc({
  size,
  iconSize,
  isPlaying,
  controlIconColor,
  onPress,
  outline,
  disableBlur,
  solidDark,
}: {
  size: number;
  iconSize: number;
  isPlaying: boolean;
  controlIconColor: string;
  onPress: () => void;
  outline?: boolean;
  /** Fil : évite le flou temps réel (BlurView) qui saccade le scroll — fallback verre statique. */
  disableBlur?: boolean;
  /** Disque noir opaque avec icône blanche (vue immersive audio). */
  solidDark?: boolean;
}) {
  const iconColor = solidDark ? '#FFFFFF' : controlIconColor;
  const icon = isPlaying ? (
    <Pause size={iconSize} color={iconColor} fill={iconColor} strokeWidth={0} />
  ) : (
    <View style={{ marginLeft: scale(size >= PLAY ? 4 : 3) }}>
      <Play size={iconSize} color={iconColor} fill={iconColor} strokeWidth={0} />
    </View>
  );

  return (
    <TouchableOpacity
      style={[
        styles.glassPlayOuter,
        outline && styles.glassPlayOuterOutline,
        solidDark && styles.glassPlaySolidDark,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      {solidDark ? (
        <View style={[StyleSheet.absoluteFillObject, styles.glassPlayContent]}>{icon}</View>
      ) : Platform.OS === 'ios' && !disableBlur ? (
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
  compactPlayWave = false,
  feedPlayDiscOutline = false,
  disableBlurDisc = false,
  deferLoadUntilPlay = false,
  wavePalette = 'ink',
  wavePeaks = null,
}: AudioPlayerProps) {
  const playerId = useId();
  const wavePlaying = wavePalette === 'onDark' ? WAVE_PLAYING_ON_DARK : WAVE_PLAYING_INK;
  const waveIdle = wavePalette === 'onDark' ? WAVE_IDLE_ON_DARK : WAVE_IDLE_INK;
  const parsedPeaks = useMemo(() => parseVoiceWavePeaks(wavePeaks ?? null), [wavePeaks]);
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
  /** Une seule createAsync en vol (prefetch + 1er tap). */
  const loadPromiseRef = useRef<Promise<Audio.Sound | null> | null>(null);
  const uriRef = useRef(uri);
  uriRef.current = uri;
  const clipWindowRef = useRef({
    active: false,
    start: 0,
    end: 0,
    len: 0,
  });
  const onStatusRef = useRef<(status: Audio.AVPlaybackStatus) => void>(() => {});

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
      fitWavePeaksToDisplayRange(
        parsedPeaks
          ? resampleWavePeaks(parsedPeaks, BAR_COUNT)
          : organicWaveBars(BAR_COUNT, 0x0a11d10),
      ),
    [parsedPeaks],
  );
  const feedBarHeights = useMemo(
    () =>
      fitWavePeaksToDisplayRange(
        parsedPeaks
          ? resampleWavePeaks(parsedPeaks, FEED_BAR_COUNT)
          : organicWaveBars(FEED_BAR_COUNT, 0x0feed01),
      ),
    [parsedPeaks],
  );

  const [waveW, setWaveW] = useState(0);
  const compact = compactPlayWave && variant !== 'feedRow';
  const isFeedWave = variant === 'coverBottom' || variant === 'feedRow';
  const waveBarCount = isFeedWave ? FEED_BAR_COUNT : BAR_COUNT;
  /** Fil (feedRow / coverBottom sans compact) : onde basse. Immersif compact : plus haute. */
  const waveHalf =
    variant === 'feedRow' || (variant === 'coverBottom' && !compact)
      ? WAVE_HALF_FEED
      : compact
        ? WAVE_HALF * 0.92
        : WAVE_HALF;
  const waveH = waveHalf * 2;
  /**
   * Slots égaux (largeur mesurée) — évite flex+gap qui arrondit chaque barre
   * différemment → espaces irréguliers sur le fil.
   */
  const slotW =
    waveW > 1
      ? Math.max(1, (waveW - BAR_GAP * (waveBarCount - 1)) / waveBarCount)
      : 0;
  /** Trait type D — proportion fixe du slot, pas de flex. */
  const needleW = slotW > 0 ? Math.max(1.5, Math.min(slotW * 0.7, scale(2.75))) : 0;
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

  const stopForCoordinator = useCallback(() => {
    setIsPlaying(false);
    const s = soundRef.current;
    if (s) void s.pauseAsync().catch(() => {});
    releaseAudioPlayback(playerId);
  }, [playerId]);

  useEffect(() => registerAudioPlayer(playerId, stopForCoordinator), [playerId, stopForCoordinator]);

  const onPlaybackStatusUpdate = useCallback((status: Audio.AVPlaybackStatus) => {
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
        releaseAudioPlayback(playerId);
        return;
      }
      setPosition(posSec);
      setTotalDuration(w.len);
      setIsPlaying(status.isPlaying);
      if (!status.isPlaying) releaseAudioPlayback(playerId);

      if (status.didJustFinish) {
        finishedRef.current = true;
        setIsPlaying(false);
        void soundRef.current?.setPositionAsync(Math.floor(w.start * 1000));
        setPosition(w.start);
        setDisplayFrac(0);
        anchorPosRef.current = 0;
        anchorTimeRef.current = Date.now();
        releaseAudioPlayback(playerId);
      }
      return;
    }

    if (status.isPlaying) {
      finishedRef.current = false;
    }
    setPosition(status.positionMillis / 1000);
    setTotalDuration(status.durationMillis ? status.durationMillis / 1000 : duration || 0);
    setIsPlaying(status.isPlaying);
    if (!status.isPlaying) releaseAudioPlayback(playerId);

    if (status.didJustFinish) {
      finishedRef.current = true;
      setIsPlaying(false);
      setPosition(0);
      setDisplayFrac(0);
      anchorPosRef.current = 0;
      anchorTimeRef.current = Date.now();
      releaseAudioPlayback(playerId);
    }
  }, [duration, playerId]);

  useEffect(() => {
    onStatusRef.current = onPlaybackStatusUpdate;
  }, [onPlaybackStatusUpdate]);

  const ensureSoundLoaded = useCallback(async (): Promise<Audio.Sound | null> => {
    const existing = soundRef.current;
    if (existing) {
      try {
        const st = await existing.getStatusAsync();
        if (st.isLoaded) return existing;
      } catch {
        /* reload below */
      }
    }

    if (loadPromiseRef.current) return loadPromiseRef.current;

    const loadUri = uriRef.current;
    const loadPromise = (async () => {
      try {
        await ensurePlaybackAudioForListening();
        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: loadUri },
          { shouldPlay: false, progressUpdateIntervalMillis: 80 },
          status => onStatusRef.current(status),
        );
        if (uriRef.current !== loadUri) {
          void newSound.unloadAsync().catch(() => {});
          return null;
        }
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
      } finally {
        if (loadPromiseRef.current === loadPromise) {
          loadPromiseRef.current = null;
        }
      }
    })();

    loadPromiseRef.current = loadPromise;
    return loadPromise;
  }, []);

  // Prefetch au mount (viewer) — fil : `deferLoadUntilPlay` → 1er tap seulement.
  useEffect(() => {
    if (deferLoadUntilPlay) return;
    if (!uri?.trim()) return;
    let cancelled = false;
    void (async () => {
      await ensureSoundLoaded();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [uri, ensureSoundLoaded, deferLoadUntilPlay]);

  useEffect(() => {
    return () => {
      const s = soundRef.current;
      soundRef.current = null;
      loadPromiseRef.current = null;
      releaseAudioPlayback(playerId);
      if (s) void s.unloadAsync().catch(() => {});
    };
  }, [playerId]);

  // Changement d’URI (recyclage fil) : reset + unload de l’ancien son.
  useEffect(() => {
    setIsPlaying(false);
    setPosition(0);
    setDisplayFrac(0);
    finishedRef.current = false;
    loadPromiseRef.current = null;
    const prev = soundRef.current;
    soundRef.current = null;
    setSound(null);
    releaseAudioPlayback(playerId);
    if (prev) void prev.unloadAsync().catch(() => {});
  }, [uri, playerId]);

  const togglePlayPause = async () => {
    try {
      let currentSound = await ensureSoundLoaded();
      if (!currentSound) return;

      let st = await currentSound.getStatusAsync();
      if (!st.isLoaded) {
        setIsPlaying(false);
        try {
          await currentSound.unloadAsync();
        } catch {
          /* ignore */
        }
        soundRef.current = null;
        setSound(null);
        currentSound = await ensureSoundLoaded();
        if (!currentSound) return;
        st = await currentSound.getStatusAsync();
        if (!st.isLoaded) return;
      }

      if (st.isPlaying) {
        await currentSound.pauseAsync();
        setIsPlaying(false);
        releaseAudioPlayback(playerId);
        return;
      }

      claimAudioPlayback(playerId);
      setIsPlaying(true);
      anchorPosRef.current = positionDisplay;
      anchorTimeRef.current = Date.now();

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
      setIsPlaying(false);
      releaseAudioPlayback(playerId);
    }
  };

  const stack = compact ? STACK / 2 : STACK;
  const playLocal = compact ? PLAY : PLAY;
  const ringSizes = [stack * 0.92, stack * 0.76, stack * 0.6];
  const feedRowH = Math.max(PLAY_FEED, waveH);

  /** Bas du bouton aligné sur le bas de l’onde (fil avec photo), sans grande pile décorative. */
  const PLAY_FLUSH_BASE = scale(54);
  const PLAY_FLUSH = PLAY_FLUSH_BASE;
  const playFeedEl = (
    <GlassPlayDisc
      size={PLAY_FEED}
      iconSize={scale(17)}
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
    <View
      style={[
        styles.playStack,
        variant === 'coverBottom' && styles.playStackCover,
        compact && variant !== 'coverBottom' && { marginBottom: scale(8) },
        { width: stack, height: stack },
      ]}
    >
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
          top: (stack - playLocal) / 2,
          left: (stack - playLocal) / 2,
        }}
      >
        <GlassPlayDisc
          size={playLocal}
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

  const waveformEl = isFeedWave ? (
    <View
      style={[
        styles.waveform,
        styles.waveformCover,
        styles.waveformFeedBars,
        { height: waveH },
      ]}
      onLayout={e => setWaveW(Math.max(0, Math.floor(e.nativeEvent.layout.width)))}
    >
      {waveW > 1 && needleW > 0
        ? feedBarHeights.map((amp, i) => {
            const h = Math.max(scale(2), amp * maxBarH);
            const isPlayed = displayFrac > 0 && (i + 1) / FEED_BAR_COUNT <= displayFrac;
            return (
              <View
                key={i}
                style={[
                  styles.feedSlot,
                  {
                    width: slotW,
                    marginRight: i < FEED_BAR_COUNT - 1 ? BAR_GAP : 0,
                    height: waveH,
                  },
                ]}
              >
                <View
                  style={{
                    width: needleW,
                    height: h,
                    borderRadius: needleW / 2,
                    backgroundColor: isPlayed ? wavePlaying : waveIdle,
                  }}
                />
              </View>
            );
          })
        : null}
    </View>
  ) : (
    <View
      style={[styles.waveform, { height: waveH }]}
      onLayout={e => setWaveW(Math.max(0, Math.floor(e.nativeEvent.layout.width)))}
    >
      {waveW > 1 && needleW > 0 ? (
        <Svg width={waveW} height={waveH} viewBox={`0 0 ${waveW} ${waveH}`}>
          {barHeights.map((amp, i) => {
            const h = Math.max(scale(2), amp * maxBarH);
            const x = i * (slotW + BAR_GAP) + (slotW - needleW) / 2;
            const y = (waveH - h) / 2;
            const isPlayed = displayFrac > 0 && (i + 1) / BAR_COUNT <= displayFrac;
            return (
              <Rect
                key={i}
                x={x}
                y={y}
                width={needleW}
                height={h}
                rx={needleW / 2}
                fill={isPlayed ? wavePlaying : waveIdle}
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
    // Compact immersif : play aligné sur le bas du bloc (wave + compteur),
    // sinon le disque reste trop haut à cause de la timeRow sous l’onde.
    if (compact) {
      return (
        <View style={[styles.containerCover, coverFlushBottom && styles.containerCoverFlush]}>
          <View style={[styles.coverBottomRow, styles.coverBottomRowCompact]}>
            <View style={styles.coverPlayLift}>
              {coverFlushBottom ? playFlushEl : playStackEl}
            </View>
            <View style={styles.coverWaveTimeCol}>
              {waveformEl}
              {timeRowEl}
            </View>
          </View>
        </View>
      );
    }
    /**
     * Fil + cover : même disque compact que feedRow, centrage vertical
     * (axe wave = pointe de la flèche) — pas de flex-end / PLAY_FLUSH.
     */
    return (
      <View style={[styles.containerCover, coverFlushBottom && styles.containerCoverFlush]}>
        <View style={styles.coverBottomRowFeed}>
          <View style={[styles.feedPlaySlot, { height: feedRowH, width: PLAY_FEED }]}>
            {playFeedEl}
          </View>
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
  /** Fil + cover : axe horizontal commun play ↔ wave (pointe de la flèche). */
  coverBottomRowFeed: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: scale(10),
  },
  /** Immersif : play + onde alignés sur le bas (timeRow sous l’onde). */
  coverBottomRowFlush: {
    alignItems: 'flex-end',
  },
  coverBottomRowCompact: {
    alignItems: 'flex-end',
  },
  /** Remonte légèrement le play au-dessus du bas du compteur. */
  coverPlayLift: {
    marginBottom: scale(10),
    flexShrink: 0,
  },
  coverWaveTimeCol: {
    flex: 1,
    minWidth: 0,
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
  glassPlaySolidDark: {
    backgroundColor: '#1C1C1E',
    borderColor: 'transparent',
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
  /** Onde fil : slots largeur fixe + air avant le bord droit de la carte. */
  waveformFeedBars: {
    gap: 0,
    paddingHorizontal: 0,
    marginRight: scale(14),
    justifyContent: 'flex-start',
    alignItems: 'center',
    overflow: 'hidden',
  },
  feedSlot: {
    alignItems: 'center',
    justifyContent: 'center',
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
