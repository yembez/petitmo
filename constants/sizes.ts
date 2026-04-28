import { scale, verticalScale, moderateScale } from '@/utils/responsive';

export const SPACING = {
  xs: scale(4),
  sm: scale(8),
  md: scale(16),
  lg: scale(24),
  xl: scale(32),
  xxl: scale(40),
};

export const FONT_SIZES = {
  xs: moderateScale(10),
  sm: moderateScale(12),
  md: moderateScale(14),
  base: moderateScale(16),
  lg: moderateScale(18),
  xl: moderateScale(20),
  xxl: moderateScale(24),
  xxxl: moderateScale(32),
};

export const ICON_SIZES = {
  xs: scale(16),
  sm: scale(20),
  md: scale(24),
  lg: scale(28),
  xl: scale(32),
};

export const BUTTON_SIZES = {
  small: {
    width: scale(100),
    height: scale(100),
    borderRadius: scale(50),
  },
  medium: {
    width: scale(110),
    height: scale(110),
    borderRadius: scale(55),
  },
  large: {
    width: scale(140),
    height: scale(140),
    borderRadius: scale(70),
  },
};

export const PROFILE_SIZES = {
  small: scale(60),
  medium: scale(96),
  large: scale(100),
};

export const HEADER_HEIGHT = verticalScale(88);
export const TAB_BAR_HEIGHT = verticalScale(64);
