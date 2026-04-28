import { View, Text, StyleSheet } from 'react-native';

const A5_RATIO = 0.7;

export interface ChapterPageProps {
  month: string;
  chapterNum: number;
  width: number;
}

export default function ChapterPage({ month, chapterNum, width }: ChapterPageProps) {
  const height = width / A5_RATIO;
  return (
    <View style={[styles.root, { width, height }]}>
      <View style={styles.inner}>
        <Text style={styles.month}>{month}</Text>
        <Text style={styles.num}>Chapitre {chapterNum}</Text>
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
    padding: 12,
  },
  month: {
    fontSize: 14,
    color: '#6B7280',
    textTransform: 'capitalize',
  },
  num: {
    marginTop: 8,
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
  },
});
