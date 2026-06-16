import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { verticalScale, scale } from '@/utils/responsive';
import { X, Check } from 'lucide-react-native';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import { useMemoryTextFontScreen } from '@/hooks/useMemoryTextFontScreen';
import {
  memoryTextEditChromeStyle,
  memoryTextEditInputStyle,
  type MemoryTextEditPreviewVariant,
} from '@/utils/memoryTextEditStyles';
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

const TEXT_INPUT_WEB_LANG =
  Platform.OS === 'web' ? ({ lang: 'fr-FR' } as Record<string, string>) : {};

export type EditTextModalProps = {
  visible: boolean;
  title?: string;
  onClose: () => void;
  embedded?: boolean;
  previewVariant?: MemoryTextEditPreviewVariant;
} & (
  | {
      initialText: string;
      variant?: 'single';
      onSave: (text: string) => void;
    }
  | {
      variant: 'title-body';
      initialTitle: string;
      initialBody: string;
      titleFieldLabel?: string;
      bodyFieldLabel?: string;
      onSave: (title: string, body: string) => void;
    }
);

export default function EditTextModal(props: EditTextModalProps) {
  if (!props.visible) return null;

  return <EditTextModalBody {...props} />;
}

function EditTextModalBody(props: EditTextModalProps & { visible: true }) {
  const insets = useSafeAreaInsets();
  const memoryTextFont = useMemoryTextFontScreen();
  const useMemoryPreview = props.previewVariant != null && props.variant !== 'title-body';

  const [text, setText] = React.useState(
    props.variant === 'title-body' ? '' : props.initialText
  );
  const [fieldTitle, setFieldTitle] = React.useState(
    props.variant === 'title-body' ? props.initialTitle : ''
  );
  const [fieldBody, setFieldBody] = React.useState(
    props.variant === 'title-body' ? props.initialBody : ''
  );

  React.useEffect(() => {
    if (props.variant === 'title-body') {
      setFieldTitle(props.initialTitle);
      setFieldBody(props.initialBody);
      return;
    }
    setText(props.initialText);
  }, [props.variant, props.initialText, props.initialTitle, props.initialBody]);

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

  const sheetTop = props.embedded ? insets.top + verticalScale(8) : insets.top + verticalScale(48);

  const memoryInputStyle = useMemo(
    () =>
      useMemoryPreview && props.previewVariant
        ? memoryTextEditInputStyle(props.previewVariant, memoryTextFont)
        : null,
    [memoryTextFont, props.previewVariant, useMemoryPreview]
  );

  const memoryChromeStyle = useMemo(
    () =>
      useMemoryPreview && props.previewVariant
        ? memoryTextEditChromeStyle(props.previewVariant)
        : null,
    [props.previewVariant, useMemoryPreview]
  );

  const sheetBody = (
    <View
      style={[
        styles.sheet,
        useMemoryPreview && styles.sheetMemoryPreview,
        { backgroundColor: useMemoryPreview ? THEME.familyFlowScreenBg : THEME.bg },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{props.title ?? 'Modifier le texte'}</Text>
        <TouchableOpacity onPress={props.onClose} hitSlop={10} accessibilityLabel="Fermer">
          <X size={ICON_SIZES.sm} color={THEME.textMuted} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <View style={styles.editorBody}>
        {props.variant === 'title-body' ? (
          <>
            <Text style={styles.fieldLabel}>{props.titleFieldLabel ?? 'Titre'}</Text>
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
            <Text style={[styles.fieldLabel, styles.fieldLabelSecond]}>
              {props.bodyFieldLabel ?? 'Texte'}
            </Text>
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
            <View
              style={[
                useMemoryPreview ? styles.memoryInputHost : styles.plainInputHost,
                memoryChromeStyle,
              ]}
            >
              <TextInput
                {...TEXT_INPUT_WEB_LANG}
                style={[
                  useMemoryPreview ? styles.memoryInput : styles.input,
                  memoryInputStyle,
                ]}
                value={text}
                onChangeText={t => setText(clampTextBookLineBudget(t))}
                placeholder="Ajouter un texte..."
                placeholderTextColor="#AEAEB2"
                multiline
                scrollEnabled
                textAlignVertical="top"
                autoFocus
                {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
              />
            </View>
            <View style={styles.footerMeta}>
              {useMemoryPreview ? (
                <Text style={styles.paragraphHint}>
                  Double saut de ligne = nouveau paragraphe (alinéa)
                </Text>
              ) : null}
              <Text style={styles.charHint}>
                {estimateBookLines(text)}/{MAX_BOOK_LINES} lignes · livre
              </Text>
            </View>
          </>
        )}
      </View>

      <TouchableOpacity
        style={[petitmoCtaStyles.primary, styles.saveButton]}
        onPress={handleSave}
        accessibilityRole="button"
        accessibilityLabel="Enregistrer"
      >
        <Check size={ICON_SIZES.sm} color={THEME.captureScreenCtaForeground} strokeWidth={2} />
        <Text style={petitmoCtaStyles.primaryText}>Enregistrer</Text>
      </TouchableOpacity>
    </View>
  );

  if (props.embedded) {
    return (
      <View style={styles.embeddedRoot}>
        <Pressable
          style={styles.embeddedDismiss}
          onPress={props.onClose}
          accessibilityLabel="Fermer"
        />
        <KeyboardAvoidingView
          style={[
            styles.embeddedSheetWrap,
            { top: sheetTop, paddingBottom: Math.max(insets.bottom, SPACING.sm) },
          ]}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <View style={styles.sheetHost}>{sheetBody}</View>
        </KeyboardAvoidingView>
      </View>
    );
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      presentationStyle="overFullScreen"
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
              paddingBottom: Math.max(insets.bottom, SPACING.sm),
            },
          ]}
        >
          {sheetBody}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  embeddedRoot: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 100,
    elevation: 100,
  },
  embeddedDismiss: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
  },
  embeddedSheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  sheetHost: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: SPACING.sm,
    zIndex: 2,
  },
  sheet: {
    flex: 1,
    minHeight: 0,
    borderRadius: scale(16),
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    overflow: 'hidden',
  },
  sheetMemoryPreview: {
    paddingHorizontal: 0,
    borderRadius: scale(20),
  },
  editorBody: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    flexShrink: 0,
    paddingHorizontal: SPACING.lg,
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
  memoryInputHost: {
    flex: 1,
    minHeight: 0,
  },
  plainInputHost: {
    flex: 1,
    minHeight: 0,
  },
  memoryInput: {
    flex: 1,
    minHeight: 0,
    padding: 0,
    margin: 0,
    backgroundColor: 'transparent',
    textAlignVertical: 'top',
  },
  input: {
    flex: 1,
    minHeight: scale(140),
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    borderRadius: scale(12),
    padding: SPACING.md,
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
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
  footerMeta: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: scale(8),
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.xs,
    flexShrink: 0,
  },
  paragraphHint: {
    flex: 1,
    fontSize: 11,
    color: '#AEAEB2',
    lineHeight: scale(15),
  },
  charHint: {
    fontSize: 11,
    color: '#AEAEB2',
    flexShrink: 0,
  },
  saveButton: {
    flexDirection: 'row',
    paddingVertical: SPACING.md,
    gap: scale(8),
    marginTop: SPACING.sm,
    marginHorizontal: SPACING.lg,
    flexShrink: 0,
  },
});
