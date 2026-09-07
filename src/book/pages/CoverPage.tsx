import { View, Text, StyleSheet } from 'react-native';
import type { Child } from '@/types/local';
import { BOOK_PAGE_RATIO } from '@/src/book/pdfPreviewTypo';

export interface CoverPageProps {
  child: Child;
  width: number;
}

export default function CoverPage({ child, width }: CoverPageProps) {
  const height = width / BOOK_PAGE_RATIO;
  return (
    <View style={[styles.root, { width, height }]}>
      <View style={styles.inner}>
        <Text style={styles.title}>Petit Cœur</Text>
        <Text style={styles.name}>{child.name}</Text>
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
    padding: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  name: {
    fontSize: 18,
    color: '#5C8FA6',
    fontWeight: '600',
  },
});
