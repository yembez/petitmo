import { View, Text, StyleSheet } from 'react-native';
import type { Child } from '@/types/local';
import { BOOK_PAGE_RATIO } from '@/src/book/pdfPreviewTypo';

export interface BackCoverPageProps {
  child: Child;
  width: number;
}

export default function BackCoverPage({ child, width }: BackCoverPageProps) {
  const height = width / BOOK_PAGE_RATIO;
  return (
    <View style={[styles.root, { width, height }]}>
      <View style={styles.inner}>
        <Text style={styles.line}>Merci d&apos;avoir vécu ces moments avec {child.name}.</Text>
        <Text style={styles.brand}>petitmo</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  line: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
  },
  brand: {
    marginTop: 16,
    fontSize: 18,
    fontWeight: '700',
    color: '#C4784A',
  },
});
