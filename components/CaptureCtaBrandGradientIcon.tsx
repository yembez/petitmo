/**
 * Icône Lucide en corail Capturer uni (`#FC5757`).
 * Nom historique « Gradient » — plus de dégradé CTA.
 */
import type { LucideIcon } from 'lucide-react-native';
import { CAPTURE_CTA_ICON_CORAL } from '@/constants/captureScreenPalette';

type Props = {
  Icon: LucideIcon;
  size: number;
  strokeWidth?: number;
};

export default function CaptureCtaBrandGradientIcon({
  Icon,
  size,
  strokeWidth = 2.4,
}: Props) {
  return <Icon size={size} color={CAPTURE_CTA_ICON_CORAL} fill="none" strokeWidth={strokeWidth} />;
}
