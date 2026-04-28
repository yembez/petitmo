import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Audio } from 'expo-av';
import { Play, Pause } from 'lucide-react-native';
import { scale } from '@/utils/responsive';
import { formatDuration } from '@/utils/date';
import { THEME } from '@/constants/theme';

const PLAY = scale(50);
const STACK = scale(104);
const BAR_COUNT = 42;
/** Demi-hauteur de l’onde (miroir haut / bas autour de l’axe central) */
const WAVE_HALF = scale(18);
/** Accent charte */
const SLATE = THEME.accent;
const WAVE_ACTIVE = '#6B9FB8';
const WAVE_INACTIVE = '#C5D9E5';
const RING = 'rgba(92, 143, 166, 0.28)';

interface AudioPlayerProps {
  uri: string;
  duration?: number;
  /** Avec photo de fond : play à gauche + onde sur la même ligne en bas */
  variant?: 'default' | 'coverBottom';
}

export default function AudioPlayer({ uri, duration, variant = 'default' }: AudioPlayerProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration || 0);

  const barHeights = useMemo(
    () =>
      Array.from({ length: BAR_COUNT }, (_, i) => {
        const t = i * 0.38 + 0.7;
        return 0.22 + 0.78 * Math.abs(Math.sin(t)) * (0.65 + 0.35 * Math.abs(Math.sin(t * 1.3)));
      }),
    []
  );

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
      setSound(newSound);
      return newSound;
    } catch (error) {
      console.error('Error loading sound:', error);
      return null;
    }
  };

  const onPlaybackStatusUpdate = (status: any) => {
    if (status.isLoaded) {
      setPosition(status.positionMillis / 1000);
      setTotalDuration(status.durationMillis ? status.durationMillis / 1000 : duration || 0);
      setIsPlaying(status.isPlaying);

      if (status.didJustFinish) {
        setIsPlaying(false);
        setPosition(0);
      }
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
      } else {
        await currentSound.playAsync();
      }
    } catch (error) {
      console.error('Error toggling play/pause:', error);
    }
  };

  const progress = totalDuration > 0 ? (position / totalDuration) * 100 : 0;
  const activeBarCount = Math.min(BAR_COUNT, Math.ceil((progress / 100) * BAR_COUNT));

  const stack = STACK;
  const ringSizes = [stack * 0.92, stack * 0.76, stack * 0.6];

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
          <Pause size={scale(22)} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
        ) : (
          <View style={{ marginLeft: scale(3) }}>
            <Play size={scale(22)} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
          </View>
        )}
      </TouchableOpacity>
    </View>
  );

  const waveformEl = (
    <View style={[styles.waveform, variant === 'coverBottom' && styles.waveformCover]}>
      {barHeights.map((h, i) => {
        const color = i < activeBarCount ? WAVE_ACTIVE : WAVE_INACTIVE;
        const half = WAVE_HALF * h;
        return (
          <View key={i} style={styles.waveColumn}>
            <View style={styles.waveHalfTop}>
              <View style={[styles.waveHalfBar, { height: half, backgroundColor: color }]} />
            </View>
            <View style={styles.waveHalfBottom}>
              <View style={[styles.waveHalfBar, { height: half, backgroundColor: color }]} />
            </View>
          </View>
        );
      })}
    </View>
  );

  const timeRowEl = (
    <View style={[styles.timeRow, variant === 'coverBottom' && styles.timeRowCover]}>
      <Text style={styles.timeText}>{formatDuration(Math.floor(position))}</Text>
      <View style={styles.timeDivider} />
      <Text style={styles.timeText}>{formatDuration(Math.floor(totalDuration))}</Text>
    </View>
  );

  if (variant === 'coverBottom') {
    return (
      <View style={styles.containerCover}>
        <View style={styles.coverBottomRow}>
          {playStackEl}
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
  coverBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    gap: scale(10),
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
  waveColumn: {
    flex: 1,
    flexDirection: 'column',
    height: WAVE_HALF * 2,
  },
  waveHalfTop: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  waveHalfBottom: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  waveHalfBar: {
    width: scale(3),
    borderRadius: scale(1.5),
    minHeight: scale(2),
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
