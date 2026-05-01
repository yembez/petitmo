import React, { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Audio } from 'expo-av';
import { Play, Pause } from 'lucide-react-native';
import Svg, { ClipPath, Defs, Path, Rect } from 'react-native-svg';
import { scale } from '@/utils/responsive';
import { formatDuration } from '@/utils/date';

const PLAY = scale(50);
const STACK = scale(104);
const BAR_COUNT = 42;
/** Points interpolés pour une courbe SVG continue (moins « barres ») */
const WAVE_SAMPLES = 80;
/** Demi-hauteur de l’onde (miroir haut / bas autour de l’axe central) */
const WAVE_HALF = scale(18);
const WAVE_ACTIVE = '#6B9FB8';
const WAVE_INACTIVE = '#C5D9E5';
const RING = 'rgba(92, 143, 166, 0.28)';

/** Enveloppe symétrique fermée : courbe haute puis basse (remplissage fluide). */
function buildSymmetricWavePath(width: number, height: number, amps: number[]): string {
  const padY = Math.max(1, scale(1));
  const mid = height / 2;
  const maxAmp = Math.max(2, mid - padY);
  const n = amps.length;
  if (width <= 1 || n < 2) return '';

  let d = '';
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * width;
    const y = mid - maxAmp * amps[i];
    d += i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  for (let i = n - 1; i >= 0; i--) {
    const x = (i / (n - 1)) * width;
    const y = mid + maxAmp * amps[i];
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  d += ' Z';
  return d;
}

interface AudioPlayerProps {
  uri: string;
  duration?: number;
  /**
   * Début de l’extrait (secondes) quand le fichier contient la prise complète.
   * Non null ⇒ lecture uniquement sur [playbackStartSec, playbackStartSec + duration].
   */
  playbackStartSec?: number | null;
  /** Avec photo de fond : play à gauche + onde sur la même ligne en bas */
  variant?: 'default' | 'coverBottom';
  /** Icônes play / pause (défaut blanc). */
  controlIconColor?: string;
  /** Réduit les marges internes pour coller play + onde au bas du visuel (ex. fil avec photo). */
  coverFlushBottom?: boolean;
}

export default function AudioPlayer({
  uri,
  duration,
  playbackStartSec,
  variant = 'default',
  controlIconColor = '#FFFFFF',
  coverFlushBottom = false,
}: AudioPlayerProps) {
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

  /** Interpolation linéaire entre les ancres « barres » → silhouette douce */
  const smoothAmps = useMemo(() => {
    const raw = barHeights;
    const n = raw.length;
    return Array.from({ length: WAVE_SAMPLES }, (_, j) => {
      const t = (j / (WAVE_SAMPLES - 1)) * (n - 1);
      const i = Math.floor(t);
      const f = t - i;
      const a = raw[i]!;
      const b = raw[Math.min(i + 1, n - 1)]!;
      return a * (1 - f) + b * f;
    });
  }, [barHeights]);

  const clipPathId = useMemo(() => `waveClip_${Math.random().toString(36).slice(2, 11)}`, []);

  const [waveW, setWaveW] = useState(0);
  const waveH = WAVE_HALF * 2;
  const wavePath = useMemo(() => {
    if (waveW <= 1) return '';
    return buildSymmetricWavePath(waveW, waveH, smoothAmps);
  }, [waveW, waveH, smoothAmps]);

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

  /** Bas du bouton aligné sur le bas de l’onde (fil avec photo), sans grande pile décorative. */
  const PLAY_FLUSH = scale(54);
  const playFlushEl = (
    <TouchableOpacity
      style={[
        styles.playButtonCoverFlush,
        {
          width: PLAY_FLUSH,
          height: PLAY_FLUSH,
          borderRadius: PLAY_FLUSH / 2,
        },
      ]}
      onPress={togglePlayPause}
      activeOpacity={0.88}
    >
      {isPlaying ? (
        <Pause size={scale(26)} color={controlIconColor} fill={controlIconColor} strokeWidth={0} />
      ) : (
        <View style={{ marginLeft: scale(4) }}>
          <Play size={scale(26)} color={controlIconColor} fill={controlIconColor} strokeWidth={0} />
        </View>
      )}
    </TouchableOpacity>
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
      <TouchableOpacity
        style={[
          styles.playButton,
          {
            top: (stack - PLAY) / 2,
            left: (stack - PLAY) / 2,
          },
        ]}
        onPress={togglePlayPause}
        activeOpacity={0.85}
      >
        {isPlaying ? (
          <Pause size={scale(22)} color={controlIconColor} fill={controlIconColor} strokeWidth={0} />
        ) : (
          <View style={{ marginLeft: scale(3) }}>
            <Play size={scale(22)} color={controlIconColor} fill={controlIconColor} strokeWidth={0} />
          </View>
        )}
      </TouchableOpacity>
    </View>
  );

  const waveformEl = (
    <View
      style={[styles.waveform, variant === 'coverBottom' && styles.waveformCover]}
      onLayout={e => setWaveW(Math.max(0, Math.floor(e.nativeEvent.layout.width)))}
    >
      {waveW > 1 && wavePath ? (
        <Svg width={waveW} height={waveH} viewBox={`0 0 ${waveW} ${waveH}`}>
          <Defs>
            <ClipPath id={clipPathId}>
              <Rect x={0} y={0} width={waveW * displayFrac} height={waveH} />
            </ClipPath>
          </Defs>
          <Path d={wavePath} fill={WAVE_INACTIVE} fillOpacity={0.88} />
          <Path d={wavePath} fill={WAVE_ACTIVE} fillOpacity={0.92} clipPath={`url(#${clipPathId})`} />
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
  playButton: {
    position: 'absolute',
    width: PLAY,
    height: PLAY,
    borderRadius: PLAY / 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(4) },
    shadowOpacity: 0.16,
    shadowRadius: scale(8),
    elevation: 4,
  },
  /** Fil vocal + photo : play bien visible, bas aligné avec l’onde */
  playButtonCoverFlush: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(4) },
    shadowOpacity: 0.38,
    shadowRadius: scale(10),
    elevation: 10,
  },
  waveform: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
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
