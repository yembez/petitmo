import { Dimensions, Platform } from 'react-native';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const DESIGN_WIDTH = 375;
const DESIGN_HEIGHT = 812;

export const wp = (percentage: number): number => {
  return (SCREEN_WIDTH * percentage) / 100;
};

export const hp = (percentage: number): number => {
  return (SCREEN_HEIGHT * percentage) / 100;
};

export const scale = (size: number): number => {
  return (SCREEN_WIDTH / DESIGN_WIDTH) * size;
};

export const verticalScale = (size: number): number => {
  return (SCREEN_HEIGHT / DESIGN_HEIGHT) * size;
};

export const moderateScale = (size: number, factor: number = 0.5): number => {
  return size + (scale(size) - size) * factor;
};

export const screenWidth = SCREEN_WIDTH;
export const screenHeight = SCREEN_HEIGHT;

export const isSmallDevice = SCREEN_WIDTH < 375;
export const isMediumDevice = SCREEN_WIDTH >= 375 && SCREEN_WIDTH < 414;
export const isLargeDevice = SCREEN_WIDTH >= 414;

export const getResponsiveValue = <T,>(small: T, medium: T, large: T): T => {
  if (isSmallDevice) return small;
  if (isMediumDevice) return medium;
  return large;
};
