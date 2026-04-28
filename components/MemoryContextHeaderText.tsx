import { Text, StyleSheet, type StyleProp, type TextStyle } from 'react-native';
import { formatDateLong, formatAgeAtMemory, parseLocationForHeader } from '@/utils/date';

type Props = {
  createdAt: string;
  childBirthdate: string | undefined;
  location: string | null | undefined;
  /** Style du conteneur : taille, couleur, interligne (les parties gras / léger héritent). */
  containerStyle: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/**
 * En-tête fil / favoris : date en gras, âge léger, ville en gras, (région) léger.
 */
export default function MemoryContextHeaderText({
  createdAt,
  childBirthdate,
  location,
  containerStyle,
  numberOfLines,
}: Props) {
  const age = formatAgeAtMemory(childBirthdate, createdAt);
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
