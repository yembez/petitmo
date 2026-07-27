import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Mic } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import { supabase } from '@/lib/supabase';
import { getCachedUserMode } from '@/lib/userMode';
import { checkMemoryLimit, invalidateMemoryLimitCache } from '@/lib/limits';
import { promptFreeTierLimitThenPaywall } from '@/utils/freeTierLimitGate';
import { getOrSelectFirstChild } from '@/services/children';
import { armFeedSnapToLatestOnFocus } from '@/services/feedScrollRestore';
import {
  MAX_BOOK_LINES,
  MAX_TEXT_MEMORY_TITLE_CHARS,
  estimateBookLines,
  clampText,
  clampTextBookLineBudget,
  enforceTextBookLineBudgetOnInput,
  TEXT_TRUNCATION_ALERT_TITLE,
  TEXT_TRUNCATION_ALERT_MESSAGE,
  TEXT_TRUNCATION_MODIFY_LABEL,
  TEXT_TRUNCATION_SAVE_LABEL,
  TEXT_SAVE_FAILED_ALERT_TITLE,
  TEXT_SAVE_FAILED_ALERT_MESSAGE,
} from '@/utils/textLimits';
import {
  applyLeadingCapitalWhenStartingText,
  capitalizeFirstLetterFr,
} from '@/utils/frenchTextInput';
import { upsertLocalMemory, getLocalMemoryById } from '@/lib/localDb';
import { buildLocalTextMemory } from '@/services/localOnlyMemoryCapture';
import { ensureMemoryUploadedForCloud } from '@/services/migration';
import { updateMemoryText } from '@/services/media';

type SpeechRecognitionResultLike = {
  isFinal: boolean
  0: { transcript: string }
}

type SpeechRecognitionEventLike = {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start: () => void
  stop: () => void
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

export default function WriteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ memoryId?: string }>();
  const editMemoryId =
    typeof params.memoryId === 'string' && params.memoryId.trim()
      ? params.memoryId.trim()
      : '';
  const isEditing = editMemoryId.length > 0;

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isWebSpeechSupported, setIsWebSpeechSupported] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const hydratedEditIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isEditing) {
      hydratedEditIdRef.current = null;
      return;
    }
    if (hydratedEditIdRef.current === editMemoryId) return;

    const mem = getLocalMemoryById(editMemoryId);
    if (!mem || mem.type !== 'text') {
      Alert.alert('Erreur', 'Ce souvenir texte est introuvable.');
      router.back();
      return;
    }

    hydratedEditIdRef.current = editMemoryId;
    setTitle(mem.text_title?.trim() ?? '');
    setContent(mem.content?.trim() ?? '');
  }, [editMemoryId, isEditing, router]);

  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const w = window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor
        webkitSpeechRecognition?: SpeechRecognitionCtor
      }
      const SpeechRecognition = w.SpeechRecognition || w.webkitSpeechRecognition;
      if (SpeechRecognition) {
        setIsWebSpeechSupported(true);
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.lang = 'fr-FR';
        recognitionRef.current.continuous = true;
        recognitionRef.current.interimResults = true;

        recognitionRef.current.onresult = (event: SpeechRecognitionEventLike) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript + ' ';
            } else {
              interimTranscript += transcript;
            }
          }

          if (finalTranscript) {
            setContent(prev => {
              const merged = prev + finalTranscript;
              const normalized =
                !prev.trim() && merged.trim()
                  ? capitalizeFirstLetterFr(merged)
                  : merged;
              return enforceTextBookLineBudgetOnInput(prev, normalized, MAX_BOOK_LINES);
            });
          }
        };

        recognitionRef.current.onerror = (event: { error: string }) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
          if (event.error !== 'no-speech' && event.error !== 'aborted') {
            Alert.alert('Erreur', 'Problème avec la dictée vocale. Réessaie.');
          }
        };

        recognitionRef.current.onend = () => {
          setIsListening(false);
        };
      }
    }

    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {}
      }
    };
  }, []);

  const toggleDictation = () => {
    if (Platform.OS !== 'web') {
      Alert.alert(
        'Non disponible',
        'La dictée vocale nécessite un development build. Utilisez la version web pour cette fonctionnalité.'
      );
      return;
    }

    if (!isWebSpeechSupported) {
      Alert.alert('Non supporté', 'Ton navigateur ne supporte pas la dictée vocale. Essaie Chrome, Edge ou Safari.');
      return;
    }

    try {
      if (isListening) {
        recognitionRef.current?.stop();
        setIsListening(false);
      } else {
        recognitionRef.current?.start();
        setIsListening(true);
      }
    } catch (error) {
      console.error('Speech recognition error:', error);
      setIsListening(false);
    }
  };

  const executeUpdate = async (textToSave: string) => {
    try {
      setIsSaving(true);
      setContent(textToSave);

      const textTitle = title.trim() ? title.trim() : null;
      const ok = await updateMemoryText(editMemoryId, {
        content: textToSave,
        textTitle,
      });

      if (!ok) {
        Alert.alert(
          'Connexion',
          "Ton texte est bien enregistré sur l’app, mais la synchronisation a échoué. Réessaie plus tard."
        );
      }

      router.back();
    } catch (error) {
      console.error('Error updating text:', error);
      Alert.alert(TEXT_SAVE_FAILED_ALERT_TITLE, TEXT_SAVE_FAILED_ALERT_MESSAGE);
    } finally {
      setIsSaving(false);
    }
  };

  const executeSave = async (textToSave: string) => {
    try {
      setIsSaving(true);
      setContent(textToSave);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Erreur', 'Utilisateur non authentifié');
        return;
      }

      const childId = await getOrSelectFirstChild();
      if (!childId) {
        Alert.alert('Aucun enfant trouvé', 'Crée d\'abord un profil d\'enfant');
        router.push('/create-child');
        return;
      }

      const limitCheck = await checkMemoryLimit(childId, { skipRemotePull: true });
      if (!limitCheck.canCreate) {
        promptFreeTierLimitThenPaywall({ kind: 'memories', router, returnTo: 'fil' });
        return;
      }

      const mode = await getCachedUserMode();
      const mem = buildLocalTextMemory({
        childId,
        userId: user.id,
        content: textToSave,
        textTitle: title.trim() ? title.trim() : null,
        location: null,
        syncStatus: mode === 'local' ? 'local' : 'pending',
      });
      upsertLocalMemory(mem);
      invalidateMemoryLimitCache(childId);
      DeviceEventEmitter.emit('petitmo:memories-inserted', { memories: [mem] });

      if (mode === 'cloud') {
        void ensureMemoryUploadedForCloud(mem);
      }

      Alert.alert('Succès', 'Moment sauvegardé avec succès');
      armFeedSnapToLatestOnFocus();
      router.push('/(tabs)/fil');
    } catch (error) {
      console.error('Error saving text:', error);
      Alert.alert(TEXT_SAVE_FAILED_ALERT_TITLE, TEXT_SAVE_FAILED_ALERT_MESSAGE);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    const trimmed = content.trim();
    const textToSave = clampText(trimmed);
    if (!textToSave) {
      Alert.alert('Erreur', 'Saisis du texte');
      return;
    }

    if (textToSave !== trimmed) {
      Alert.alert(TEXT_TRUNCATION_ALERT_TITLE, TEXT_TRUNCATION_ALERT_MESSAGE, [
        { text: TEXT_TRUNCATION_MODIFY_LABEL, style: 'cancel' },
        { text: TEXT_TRUNCATION_SAVE_LABEL, onPress: () => void executeSave(textToSave) },
      ]);
      return;
    }

    await (isEditing ? executeUpdate(textToSave) : executeSave(textToSave));
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ChevronLeft size={ICON_SIZES.lg} color="#3F4A5A" strokeWidth={2} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleSave}
          style={[petitmoCtaStyles.primary, styles.saveButton, isSaving && petitmoCtaStyles.primaryDisabled]}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={PETITMO_CTA_SPINNER_COLOR} />
          ) : (
            <Text style={petitmoCtaStyles.primaryText}>Enregistrer</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.titleInput}
          placeholder="Titre (optionnel)"
          placeholderTextColor="#AEAEB2"
          value={title}
          onChangeText={t =>
            setTitle(prev =>
              applyLeadingCapitalWhenStartingText(prev, t).slice(0, MAX_TEXT_MEMORY_TITLE_CHARS)
            )
          }
          maxLength={MAX_TEXT_MEMORY_TITLE_CHARS}
          returnKeyType="next"
          autoCapitalize="sentences"
          autoCorrect
        />
        <TextInput
          style={styles.input}
          multiline
          placeholder="Écris-lui ce que tu aimerais lui dire aujourd'hui…"
          placeholderTextColor="#0F0F0F"
          value={content}
          onChangeText={t =>
            setContent(prev =>
              enforceTextBookLineBudgetOnInput(
                prev,
                applyLeadingCapitalWhenStartingText(prev, t),
                MAX_BOOK_LINES,
              )
            )
          }
          autoFocus
          textAlignVertical="top"
          autoCapitalize="sentences"
          autoCorrect
        />
        <Text style={styles.charCounter}>
          {estimateBookLines(content)}/{MAX_BOOK_LINES} lignes · livre
        </Text>

        {Platform.OS === 'web' && isWebSpeechSupported && (
          <TouchableOpacity
            style={[styles.micButton, isListening && styles.micButtonActive]}
            onPress={toggleDictation}
            activeOpacity={0.8}>
            <Mic size={ICON_SIZES.md} color={isListening ? '#FFFFFF' : THEME.accent} strokeWidth={2.5} />
          </TouchableOpacity>
        )}

        {isListening && (
          <View style={styles.listeningIndicator}>
            <View style={styles.pulseCircle} />
            <Text style={styles.listeningText}>🎤 Écoute...</Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: verticalScale(40),
    paddingBottom: SPACING.md,
  },
  backButton: {
    padding: SPACING.sm,
  },
  saveButton: {
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.lg,
  },
  inputContainer: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    position: 'relative',
  },
  titleInput: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: '#1C1C1E',
    lineHeight: scale(26),
    marginBottom: SPACING.sm,
    paddingBottom: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  input: {
    flex: 1,
    fontSize: FONT_SIZES.md,
    color: '#000000',
    lineHeight: scale(22),
    paddingBottom: scale(80),
  },
  charCounter: {
    position: 'absolute',
    bottom: scale(60),
    right: 0,
    fontSize: 12,
    color: '#AEAEB2',
  },
  micButton: {
    position: 'absolute',
    right: SPACING.lg,
    bottom: SPACING.xl,
    width: scale(60),
    height: scale(60),
    borderRadius: scale(30),
    backgroundColor: '#FFF5F3',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: THEME.accent,
    shadowOffset: { width: 0, height: scale(4) },
    shadowOpacity: 0.3,
    shadowRadius: scale(12),
    elevation: 6,
    borderWidth: scale(2),
    borderColor: '#FFE5E0',
  },
  micButtonActive: {
    backgroundColor: THEME.accent,
    borderColor: THEME.accent,
    shadowOpacity: 0.5,
  },
  listeningIndicator: {
    position: 'absolute',
    bottom: scale(100),
    alignSelf: 'center',
    backgroundColor: '#3F4A5A',
    paddingVertical: scale(10),
    paddingHorizontal: SPACING.lg,
    borderRadius: scale(20),
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: scale(2) },
    shadowOpacity: 0.2,
    shadowRadius: scale(8),
    elevation: 4,
  },
  pulseCircle: {
    width: scale(8),
    height: scale(8),
    borderRadius: scale(4),
    backgroundColor: THEME.accent,
  },
  listeningText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
  },
});
