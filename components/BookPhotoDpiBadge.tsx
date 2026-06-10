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

function statusColors(status: BookPhotoDpiStatus): { bg: string; text: string } {
  switch (status) {
    case 'ok':
      return { bg: 'rgba(28, 28, 30, 0.55)', text: '#FFFFFF' };
    case 'warn':
      return { bg: 'rgba(255, 209, 102, 0.92)', text: '#3C3126' };
    case 'block':
      return { bg: 'rgba(255, 107, 107, 0.92)', text: '#FFFFFF' };
    default:
      return { bg: 'rgba(28, 28, 30, 0.45)', text: 'rgba(255,255,255,0.85)' };
  }
}

function BookPhotoDpiBadge({ imgPxW, imgPxH, printMmW, printMmH, scale }: Props) {
  const dpi = effectiveBookPhotoPrintDpi({ imgPxW, imgPxH, printMmW, printMmH, scale });
  const status = bookPhotoDpiStatus(dpi);
  const colors = statusColors(status);
  const label = bookPhotoDpiStatusLabel(status);

  return (
    <View style={[styles.wrap, { backgroundColor: colors.bg }]} pointerEvents="none">
      <Text style={[styles.line, { color: colors.text }]}>
        Impression : {dpi > 0 ? `${dpi} DPI` : '—'}
      </Text>
      <Text style={[styles.subline, { color: colors.text }]}>{label}</Text>
    </View>
  );
}

export default memo(BookPhotoDpiBadge);

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    alignItems: 'flex-start',
  },
  line: {
    fontSize: 12,
    textAlign: 'left',
    fontWeight: '400',
  },
  subline: {
    fontSize: 11,
    textAlign: 'left',
    fontWeight: '400',
    marginTop: 2,
    opacity: 0.92,
  },
});
