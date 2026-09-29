import { Image, StyleSheet, View, type ImageSourcePropType } from 'react-native';

/**
 * Wordmark manuscrit empilé « Petit / Cœur » — source `LOGO_4_text_only.png`
 * (sans bulle message ni cœur). Ratio crop ~1200×1030.
 */
export const PETIT_COEUR_WORDMARK_VIEWBOX = { width: 1200, height: 1030 } as const;

const WORDMARK_CORAL = require('@/assets/images/logo_petit_coeur_wordmark_coral.png') as ImageSourcePropType;
const WORDMARK_WHITE = require('@/assets/images/logo_petit_coeur_wordmark_white.png') as ImageSourcePropType;
const WORDMARK_NOIR = require('@/assets/images/logo_petit_coeur_wordmark_noir.png') as ImageSourcePropType;

type Props = {
  width: number;
  /** `coral` = charte ; `white` / `noir` = aplats. */
  variant?: 'coral' | 'white' | 'noir';
  opacity?: number;
};

function sourceFor(variant: NonNullable<Props['variant']>): ImageSourcePropType {
  switch (variant) {
    case 'white':
      return WORDMARK_WHITE;
    case 'noir':
      return WORDMARK_NOIR;
    default:
      return WORDMARK_CORAL;
  }
}

export default function PetitCoeurWordmark({
  width,
  variant = 'coral',
  opacity = 1,
}: Props) {
  const height = width * (PETIT_COEUR_WORDMARK_VIEWBOX.height / PETIT_COEUR_WORDMARK_VIEWBOX.width);
  return (
    <View style={{ width, height, opacity }}>
      <Image
        source={sourceFor(variant)}
        style={[styles.img, { width, height }]}
        resizeMode="contain"
        accessibilityLabel="Petit Cœur"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  img: {
    backgroundColor: 'transparent',
  },
});
