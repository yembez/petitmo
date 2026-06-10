import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  ScrollView,
  Alert,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { verticalScale } from '@/utils/responsive';
import { X, Check } from 'lucide-react-native';
import { scale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import {
  MAX_BOOK_LINES,
  estimateBookLines,
  clampText,
  clampTextBookLineBudget,
  TEXT_TRUNCATION_ALERT_TITLE,
  TEXT_TRUNCATION_ALERT_MESSAGE,
  TEXT_TRUNCATION_MODIFY_LABEL,
  TEXT_TRUNCATION_SAVE_LABEL,
} from '@/utils/textLimits';

const SCREEN_WIDTH = Dimensions.get('window').width;

/** Sur le Web, fixe la langue du champ (orthographe / attribut HTML `lang`). Les menus natifs iOS/Android restent gérés par le système. */
const TEXT_INPUT_WEB_LANG =
  Platform.OS === 'web' ? ({ lang: 'fr-FR' } as Record<string, string>) : {};

export type EditTextModalProps =
  | {
      visible: boolean;
      initialText: string;
      title?: string;
      variant?: 'single';
      onClose: () => void;
      onSave: (text: string) => void;
    }
  | {
      visible: boolean;
      variant: 'title-body';
      initialTitle: string;
      initialBody: string;
      title?: string;
      titleFieldLabel?: string;
      bodyFieldLabel?: string;
      onClose: () => void;
      onSave: (title: string, body: string) => void;
    };

export default function EditTextModal(props: EditTextModalProps) {
  const insets = useSafeAreaInsets();

  const [text, setText] = React.useState(
    props.variant === 'title-body' ? '' : props.initialText
  );
  const [fieldTitle, setFieldTitle] = React.useState(
    props.variant === 'title-body' ? props.initialTitle : ''
  );
  const [fieldBody, setFieldBody] = React.useState(
    props.variant === 'title-body' ? props.initialBody : ''
  );

  const handleSave = () => {
    if (props.variant === 'title-body') {
      props.onSave(fieldTitle, fieldBody);
      props.onClose();
      return;
    }

    const raw = text.trim();
    const finalText = clampText(raw);

    if (finalText !== raw) {
      Alert.alert(TEXT_TRUNCATION_ALERT_TITLE, TEXT_TRUNCATION_ALERT_MESSAGE, [
        { text: TEXT_TRUNCATION_MODIFY_LABEL, style: 'cancel' },
        {
          text: TEXT_TRUNCATION_SAVE_LABEL,
          onPress: () => {
            props.onSave(finalText);
            props.onClose();
          },
        },
      ]);
      return;
    }

    props.onSave(finalText);
    props.onClose();
  };

  /** Sous la barre de statut + ligne d’infos du viewer immersif. */
  const sheetTop = insets.top + verticalScale(72);

  const headerTitle = props.title ?? 'Modifier le texte';
  const titleFieldLabel =
    props.variant === 'title-body' ? props.titleFieldLabel ?? 'Titre' : null;
  const bodyFieldLabel =
    props.variant === 'title-body' ? props.bodyFieldLabel ?? 'Texte' : null;

  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} accessibilityLabel="Fermer" />
        <View
          style={[
            styles.sheetHost,
            {
              marginTop: sheetTop,
              paddingBottom: Math.max(insets.bottom, SPACING.md),
            },
          ]}
        >
          <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>{headerTitle}</Text>
            <TouchableOpacity onPress={props.onClose} hitSlop={10}>
              <X size={ICON_SIZES.sm} color={THEME.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            bounces={false}
          >
            {props.variant === 'title-body' ? (
              <>
                <Text style={styles.fieldLabel}>{titleFieldLabel}</Text>
                <TextInput
                  {...TEXT_INPUT_WEB_LANG}
                  style={styles.inputTitle}
                  value={fieldTitle}
                  onChangeText={setFieldTitle}
                  placeholder="Titre…"
                  placeholderTextColor="#9CA3AF"
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  maxLength={100}
                  autoFocus
                />
                <Text style={[styles.fieldLabel, styles.fieldLabelSecond]}>{bodyFieldLabel}</Text>
                <TextInput
                  {...TEXT_INPUT_WEB_LANG}
                  style={styles.input}
                  value={fieldBody}
                  onChangeText={setFieldBody}
                  placeholder="Texte…"
                  placeholderTextColor="#9CA3AF"
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  maxLength={500}
                />
                <Text style={styles.charHint}>{fieldBody.length}/500</Text>
              </>
            ) : (
              <>
                <TextInput
                  {...TEXT_INPUT_WEB_LANG}
                  style={styles.input}
                  value={text}
                  onChangeText={t => setText(clampTextBookLineBudget(t))}
                  placeholder="Ajouter un texte..."
                  placeholderTextColor="#9CA3AF"
                  multiline
                  scrollEnabled
                  textAlignVertical="top"
                  autoFocus
                />
                <Text style={styles.charHint}>
                  {estimateBookLines(text)}/{MAX_BOOK_LINES} lignes · livre
                </Text>
              </>
            )}
          </ScrollView>

          <TouchableOpacity
            style={[petitmoCtaStyles.primary, styles.saveButton]}
            onPress={handleSave}
          >
            <Check size={ICON_SIZES.sm} color={THEME.captureScreenCtaForeground} strokeWidth={2} />
            <Text style={[petitmoCtaStyles.primaryText, styles.saveButtonText]}>Enregistrer</Text>
          </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheetHost: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: SPACING.md,
  },
  sheet: {
    flex: 1,
    minHeight: 0,
    backgroundColor: THEME.bg,
    borderRadius: scale(16),
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.lg,
    overflow: 'hidden',
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    marginRight: SPACING.sm,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  fieldLabel: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    color: THEME.textMuted,
    marginBottom: SPACING.xs,
  },
  fieldLabelSecond: {
    marginTop: SPACING.md,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    borderRadius: scale(12),
    padding: SPACING.md,
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    minHeight: scale(120),
    maxHeight: scale(200),
    textAlignVertical: 'top',
    backgroundColor: THEME.bg,
  },
  inputTitle: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    borderRadius: scale(12),
    padding: SPACING.md,
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    minHeight: scale(52),
    maxHeight: scale(100),
    textAlignVertical: 'top',
    backgroundColor: THEME.bg,
  },
  charHint: {
    alignSelf: 'flex-end',
    fontSize: 11,
    color: '#AEAEB2',
    marginTop: 4,
    marginBottom: SPACING.sm,
  },
  saveButton: {
    flexDirection: 'row',
    paddingVertical: SPACING.md,
    gap: scale(8),
    marginTop: SPACING.md,
    flexShrink: 0,
  },
});
