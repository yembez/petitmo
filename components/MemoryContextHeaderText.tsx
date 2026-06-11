import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { formatDateLong, parseLocationForHeader } from '@/utils/date';
import type { Child } from '@/types/local';
import { formatFamilyAgesLine } from '@/utils/childrenAge';

type Props = {
  createdAt: string;
  familyChildren: Child[];
  location: string | null | undefined;
  /** Style du conteneur : taille, couleur, interligne (les parties gras / léger héritent). */
  containerStyle: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/**
 * En-tête fil / favoris : date en gras, âges famille légers, ville en gras, (région) léger.
 */
export default function MemoryContextHeaderText({
  createdAt,
  familyChildren,
  location,
  containerStyle,
  numberOfLines,
}: Props) {
  const age = formatFamilyAgesLine(familyChildren, createdAt);
  const { placeBold, regionNormal } = parseLocationForHeader(location);

  return (
    <Text style={containerStyle} numberOfLines={numberOfLines}>
      <Text style={styles.bold}>{formatDateLong(createdAt)}</Text>
      {age ? (
        <>
          <Text style={styles.sep}> · </Text>
          <Text style={styles.light}>{age}</Text>
        </>
      ) : null}
      {placeBold ? (
        <>
          <Text style={styles.sep}> · </Text>
          <Text style={styles.bold}>{placeBold}</Text>
          {regionNormal != null ? (
            <Text style={styles.light}>{` (${regionNormal})`}</Text>
          ) : null}
        </>
      ) : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  bold: {
    fontWeight: '700',
  },
  light: {
    fontWeight: '400',
  },
  sep: {
    fontWeight: '400',
  },
});
