import React from 'react';
import { Image } from 'react-native';

interface CaptureIconProps {
  size?: number;
  color?: string;
}

export default function CaptureIcon({
  size = 24,
  color = 'currentColor'
}: CaptureIconProps) {
  return (
    <Image
      source={require('@/assets/images/capture_icon_transp_small3_bolder2.svg')}
      style={{
        width: size,
        height: size,
        tintColor: color,
      }}
      resizeMode="contain"
    />
  );
}
