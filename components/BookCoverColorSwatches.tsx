import { View, StyleSheet } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import {
  BOOK_COVER_COLOR_SWATCHES,
  parseBookCoverColorId,
  type BookCoverColorId,
} from '@/constants/bookCoverColors';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';

type Props = {
  value: BookCoverColorId | string | null | undefined;
  onChange: (id: BookCoverColorId) => void;
  /** Pastilles liste Livres : une ligne pleine largeur. */
  compact?: boolean;
};

export default function BookCoverColorSwatches({ value, onChange, compact = false }: Props) {
  const selectedId = parseBookCoverColorId(value);
  const size = compact ? scale(22) : scale(28);

  return (
    <View
      style={compact ? styles.rowCompact : styles.rowDefault}
      accessibilityRole="radiogroup"
      accessibilityLabel="Couleur de couverture"
    >
      {BOOK_COVER_COLOR_SWATCHES.map(swatch => {
        const selected = swatch.id === selectedId;
        return (
          <Pressable
            key={swatch.id}
            onPress={() => onChange(swatch.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={swatch.label}
            hitSlop={8}
            style={({ pressed }) => [
              compact ? styles.hitCompact : styles.hit,
              pressed && { opacity: 0.85 },
            ]}
          >
            <View
              style={[
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  backgroundColor: swatch.paper,
                  borderColor: selected ? THEME.brandPrimary : 'rgba(0,0,0,0.14)',
                  borderWidth: selected ? (compact ? 2 : 2.5) : StyleSheet.hairlineWidth,
                },
              ]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rowDefault: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(10),
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(12),
  },
  rowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  hit: {
    padding: scale(2),
  },
  hitCompact: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: scale(4),
  },
});
