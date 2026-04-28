import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Camera, Pencil } from 'lucide-react-native';
import { THEME } from '@/constants/theme';

interface CameraPencilIconProps {
  size?: number;
  color?: string;
}

export default function CameraPencilIcon({
  size = 24,
  color = '#000000'
}: CameraPencilIconProps) {
  const cameraSize = size;
  const pencilSize = size * 0.8;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <View style={styles.cameraLayer}>
        <Camera
          size={cameraSize}
          color={color}
          strokeWidth={2}
        />
      </View>
      <View style={[styles.pencilLayer, {
        top: -size * 0.2,
        right: -size * 0.22
      }]}>
        <Pencil
          size={pencilSize}
          color={color}
          strokeWidth={2.2}
          fill={THEME.bgScreen}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraLayer: {
    position: 'absolute',
    zIndex: 1,
  },
  pencilLayer: {
    position: 'absolute',
    zIndex: 2,
  },
});
