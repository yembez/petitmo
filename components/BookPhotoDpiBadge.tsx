import { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  bookPhotoDpiStatus,
  bookPhotoDpiStatusLabel,
  effectiveBookPhotoPrintDpi,
  type BookPhotoDpiStatus,
} from '@/utils/bookPhotoPrintDpi';

type Props = {
  imgPxW: number;
  imgPxH: number;
  printMmW: number;
  printMmH: number;
  scale: number;
};

const COLOR_OK = '#1B7F4E';
const COLOR_WARN = '#C48A00';
const COLOR_BAD = '#E5484D';

function statusColor(status: BookPhotoDpiStatus): string {
  switch (status) {
    case 'ok':
      return COLOR_OK;
    case 'warn':
      return COLOR_WARN;
    case 'block':
      return COLOR_BAD;
    default:
      return 'rgba(60,60,67,0.55)';
  }
}

function BookPhotoDpiBadge({ imgPxW, imgPxH, printMmW, printMmH, scale }: Props) {
  const dpi = effectiveBookPhotoPrintDpi({ imgPxW, imgPxH, printMmW, printMmH, scale });
  const dpiStatus: BookPhotoDpiStatus = bookPhotoDpiStatus(dpi);
  const label = bookPhotoDpiStatusLabel(dpiStatus);
  const color = statusColor(dpiStatus);

  const line =
    dpiStatus === 'unknown'
      ? label
      : dpiStatus === 'block'
        ? `${label} = ${dpi} DPI`
        : `${label} · ${dpi} DPI`;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Text style={[styles.base, { color }]}>{line}</Text>
    </View>
  );
}

export default memo(BookPhotoDpiBadge);

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,0,0,0.10)',
    alignItems: 'flex-start',
  },
  base: {
    fontSize: 12,
    fontWeight: '600',
  },
});
