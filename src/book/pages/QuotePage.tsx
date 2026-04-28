import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useFonts, DMSans_400Regular, DMSans_400Regular_Italic, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { EBGaramond_400Regular_Italic } from '@expo-google-fonts/eb-garamond';
import type { Memory } from '@/types/local';
import EditTextModal from '@/components/EditTextModal';

const A5_RATIO = 0.7;

export interface QuotePageProps {
  memory: Memory;
  width: number;
  pageNumber?: number;
  onEdit: (newText: string) => void;
}

function formatBookDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleDateString('fr-FR', { month: 'long' }).toUpperCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export default function QuotePage({
  memory,
  width,
  pageNumber = 1,
  onEdit,
}: QuotePageProps) {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_400Regular_Italic,
    DMSans_600SemiBold,
    EBGaramond_400Regular_Italic,
  });

  const [editOpen, setEditOpen] = useState(false);

  const height = width / A5_RATIO;
  const dm400 = fontsLoaded ? 'DMSans_400Regular' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const dmItalic = fontsLoaded ? 'DMSans_400Regular_Italic' : undefined;
  const garamondIt = fontsLoaded ? 'EBGaramond_400Regular_Italic' : undefined;

  const bodyText = memory.content ?? '';

  const quoteMarkSize = width * 0.18;
  const bodyFontSize = width * 0.055;
  const bodyLineHeight = bodyFontSize * 1.65;

  const handleSave = useCallback(
    (text: string) => {
      onEdit(text);
    },
    [onEdit]
  );

  return (
    <View style={[styles.root, { width, height }]}>
      <View style={styles.banner}>
        <View style={styles.bannerLeft}>
          <View style={styles.bannerDot} />
          <Text
            style={[
              styles.bannerLabel,
              dm600 ? { fontFamily: dm600 } : { fontWeight: '600' },
            ]}
          >
            Petits mots
          </Text>
        </View>
      </View>

      <Pressable
        style={styles.bodyPress}
        onPress={() => setEditOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Modifier le texte"
      >
        <View style={styles.bodyInner}>
          <Text
            style={[
              styles.quoteMark,
              {
                fontSize: quoteMarkSize,
                fontFamily: garamondIt,
                fontStyle: garamondIt ? undefined : 'italic',
              },
            ]}
          >
            {'\u201C'}
          </Text>
          <Text
            style={[
              styles.quoteBody,
              {
                fontSize: bodyFontSize,
                lineHeight: bodyLineHeight,
                fontFamily: garamondIt,
                fontStyle: garamondIt ? undefined : 'italic',
              },
            ]}
          >
            {bodyText}
          </Text>
          <View style={styles.ornament}>
            <View style={styles.ornamentLine} />
            <View style={styles.ornamentDot} />
            <View style={styles.ornamentLine} />
          </View>
          <Text style={[styles.bodyDate, dm400 && { fontFamily: dm400 }]}>
            {formatBookDate(memory.created_at)}
          </Text>
        </View>
      </Pressable>

      <View style={styles.folio}>
        <Text style={[styles.folioText, dm400 && { fontFamily: dm400 }]}>
          {pageNumber}
        </Text>
      </View>

      <EditTextModal
        visible={editOpen}
        initialText={memory.content ?? ''}
        title="Modifier le texte"
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  banner: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingHorizontal: 14,
    backgroundColor: '#FFFFFF',
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bannerDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#7CA88C',
  },
  bannerLabel: {
    fontSize: 7,
    color: '#1C1C1E',
  },
  bodyPress: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  bodyInner: {
    flex: 1,
    paddingHorizontal: 14,
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 16,
    overflow: 'hidden',
  },
  quoteMark: {
    alignSelf: 'flex-start',
    marginBottom: 10,
    color: 'rgba(28, 28, 30, 0.05)',
  },
  quoteBody: {
    color: '#1C1C1E',
    textAlign: 'center',
  },
  ornament: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 200,
    gap: 8,
    opacity: 0.1,
  },
  ornamentLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#1C1C1E',
    minHeight: 1,
  },
  ornamentDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#1C1C1E',
  },
  bodyDate: {
    alignSelf: 'flex-end',
    textAlign: 'right',
    marginTop: 12,
    fontSize: 6,
    color: '#AEAEB2',
  },
  folio: {
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  folioText: {
    fontSize: 6,
    color: '#C7C7CC',
  },
});
