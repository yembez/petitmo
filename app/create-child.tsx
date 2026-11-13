import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Image,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
  Switch,
  useWindowDimensions,
} from 'react-native';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ImageIcon } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import CaptureReminderTimeSheet from '@/components/parentSpace/CaptureReminderTimeSheet';
import { createChild, setSelectedChild } from '@/services/children';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import {
  DEFAULT_NOTIFICATION_PREFS,
  peekCachedNotificationPrefs,
  saveNotificationPrefs,
  snapCaptureReminderTimeToSlot,
} from '@/lib/notificationPrefs';
import { ensureProvisionalNotificationsAuthorization } from '@/lib/onboardingPermissions';
import { registerPushTokenInBackground } from '@/services/registerPushToken';
import DatePicker from '@/components/DatePicker';
import { CropModal } from '@/components/CropModal';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';

function joinSoftList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} et ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

export default function CreateChildScreen() {
  const router = useRouter();
  const { t } = useAppTranslation('common');
  const insets = useSafeAreaInsets();
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const { height: windowH } = useWindowDimensions();
  const [childName, setChildName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [cropVisible, setCropVisible] = useState(false);
  const [rawImageUri, setRawImageUri] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [backBusy, setBackBusy] = useState(false);
  const [missingHint, setMissingHint] = useState<string | null>(null);
  /** Après un tap Continuer incomplet : liserés rouges sur les champs encore vides. */
  const [showFieldErrors, setShowFieldErrors] = useState(false);
  /** Opt-in rappel soir — enregistré avec le profil (défaut 21:00). */
  const [eveningReminderEnabled, setEveningReminderEnabled] = useState(false);
  const [eveningReminderTime, setEveningReminderTime] = useState(
    DEFAULT_NOTIFICATION_PREFS.captureReminderLocalTime,
  );
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);

  useEffect(() => {
    void peekCachedNotificationPrefs().then(prefs => {
      setEveningReminderEnabled(!!prefs.captureReminderEnabled);
      setEveningReminderTime(
        prefs.captureReminderLocalTime?.trim() ||
          DEFAULT_NOTIFICATION_PREFS.captureReminderLocalTime,
      );
    });
  }, []);

  const hasName = !!childName.trim();
  const hasBirth = !!birthDate.trim();
  const hasPhoto = !!photoUri;
  const formComplete = hasName && hasBirth && hasPhoto;

  const missingItems = useMemo(() => {
    const items: string[] = [];
    if (!hasPhoto) items.push(t('createChild.missingPhoto'));
    if (!hasName) items.push(t('createChild.missingName'));
    if (!hasBirth) items.push(t('createChild.missingBirth'));
    return items;
  }, [hasBirth, hasName, hasPhoto, t]);

  const softMissingMessage = useCallback(() => {
    if (missingItems.length === 0) return null;
    if (missingItems.length === 1) {
      return t('createChild.missingHintOne', { item: missingItems[0] });
    }
    return t('createChild.missingHintMany', { items: joinSoftList(missingItems) });
  }, [missingItems, t]);

  useEffect(() => {
    if (!showFieldErrors) return;
    if (formComplete) {
      setMissingHint(null);
      setShowFieldErrors(false);
      return;
    }
    setMissingHint(softMissingMessage());
  }, [formComplete, showFieldErrors, softMissingMessage]);

  const handleBack = useCallback(async () => {
    if (backBusy) return;
    setBackBusy(true);
    try {
      const uid = peekLastRealAuthUserId();
      const localCount = uid ? listLocalChildrenForUser(uid).length : 0;
      // Premier profil (post-auth) : back si pile OK ; sinon rester (profil obligatoire).
      if (localCount === 0) {
        if (router.canGoBack()) {
          router.back();
        }
        return;
      }
      // Ajout d’un enfant depuis l’app : retour normal.
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace('/(tabs)');
    } catch (e) {
      console.warn('[create-child] handleBack', e);
      if (router.canGoBack()) {
        router.back();
      }
    } finally {
      setBackBusy(false);
    }
  }, [backBusy, router]);

  /** Avatar : PHPicker iOS sans accès photothèque général (pas besoin date/lieu). */
  const openImagePickerForCrop = useCallback(async () => {
    // Pas d’`allowsEditing` natif (souvent sans zoom fiable) → CropModal pinch/pan.
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      setRawImageUri(result.assets[0].uri);
      setCropVisible(true);
    }
  }, []);

  const handlePhotoUpload = () => {
    void openImagePickerForCrop();
  };

  const handleContinue = async () => {
    if (isCreating) return;
    if (!formComplete) {
      setShowFieldErrors(true);
      setMissingHint(softMissingMessage());
      return;
    }

    try {
      setIsCreating(true);
      setMissingHint(null);
      setShowFieldErrors(false);

      const child = await createChild(childName.trim(), birthDate, photoUri || undefined);

      if (child) {
        const snapped = snapCaptureReminderTimeToSlot(eveningReminderTime);
        if (eveningReminderEnabled) {
          await ensureProvisionalNotificationsAuthorization();
          void registerPushTokenInBackground();
        }
        await saveNotificationPrefs({
          captureReminderEnabled: eveningReminderEnabled,
          captureReminderLocalTime: snapped,
        });

        await setSelectedChild(child.id);
        // Peindre Capturer immédiatement depuis SQLite (sync cloud déjà en fond).
        hydrateTabScreensFromSqliteSync();
        router.replace('/(tabs)');
      } else {
        Alert.alert(t('error'), t('createChild.createFailed'));
      }
    } catch (error) {
      console.error('Error creating child:', error);
      Alert.alert(t('error'), t('createChild.createError'));
    } finally {
      setIsCreating(false);
    }
  };

  if (!fontsLoaded) {
    return (
      <View style={[styles.container, styles.fontsGate]}>
        <ActivityIndicator color={THEME.textPrimary} size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: insets.top + verticalScale(8),
            paddingBottom: Math.max(insets.bottom, verticalScale(16)) + verticalScale(32),
            minHeight: windowH - insets.top - insets.bottom,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={() => void handleBack()}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            disabled={backBusy}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ChevronLeft size={ICON_SIZES.lg} color={THEME.textPrimary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <Text
          style={[
            styles.title,
            missingHint ? styles.titleWithHint : null,
            dm700 ? { fontFamily: dm700 } : null,
          ]}
        >
          {t('createChild.title')}
        </Text>

        {missingHint ? (
          <Text
            style={[styles.missingHint, dm600 ? { fontFamily: dm600 } : null]}
            accessibilityLiveRegion="polite"
          >
            {missingHint}
          </Text>
        ) : null}

        <View style={styles.photoSection}>
          {photoUri ? (
            <TouchableOpacity onPress={handlePhotoUpload} activeOpacity={0.8}>
              <Image
                source={{ uri: photoUri }}
                style={[
                  styles.photoPreview,
                  showFieldErrors && !hasPhoto ? styles.photoErrorRing : null,
                ]}
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handlePhotoUpload}
              style={[
                styles.photoPlaceholder,
                showFieldErrors && !hasPhoto ? styles.photoErrorRing : null,
              ]}
              activeOpacity={0.8}
            >
              <ImageIcon size={ICON_SIZES.xl} color={THEME.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={handlePhotoUpload} activeOpacity={0.7}>
            <Text style={[styles.addPhotoText, dm500 ? { fontFamily: dm500 } : null]}>
              {t('createChild.addPhoto')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.formSection}>
          <View style={styles.inputGroup}>
            <Text style={[styles.label, dm600 ? { fontFamily: dm600 } : null]}>
              {t('createChild.nameLabel')}
            </Text>
            <TextInput
              style={[
                styles.input,
                dm500 ? { fontFamily: dm500 } : null,
                showFieldErrors && !hasName ? styles.inputError : null,
              ]}
              value={childName}
              onChangeText={setChildName}
              placeholder={t('createChild.namePlaceholder')}
              placeholderTextColor={THEME.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, dm600 ? { fontFamily: dm600 } : null]}>
              {t('createChild.birthLabel')}
            </Text>
            <DatePicker
              value={birthDate}
              onChange={setBirthDate}
              placeholder={t('createChild.birthPlaceholder')}
              hasError={showFieldErrors && !hasBirth}
            />
          </View>

          <View style={styles.reminderBlock}>
            <View style={styles.reminderRow}>
              <View style={styles.reminderCopy}>
                <Text style={[styles.reminderLabel, dm600 ? { fontFamily: dm600 } : null]}>
                  {t('createChild.eveningReminderLabel')}
                </Text>
                <Text style={[styles.reminderHint, dm500 ? { fontFamily: dm500 } : null]}>
                  {t('createChild.eveningReminderHint')}
                </Text>
              </View>
              <Switch
                value={eveningReminderEnabled}
                onValueChange={setEveningReminderEnabled}
                trackColor={{ false: 'rgba(81,84,94,0.22)', true: THEME.brandPrimary }}
                thumbColor="#FFFFFF"
                accessibilityLabel={t('createChild.eveningReminderLabel')}
              />
            </View>
            {eveningReminderEnabled ? (
              <TouchableOpacity
                onPress={() => setTimeSheetOpen(true)}
                style={styles.reminderTimeRow}
                accessibilityRole="button"
                accessibilityLabel={t('createChild.eveningReminderTimeA11y', {
                  time: eveningReminderTime,
                })}
              >
                <Text style={[styles.reminderTimeLabel, dm500 ? { fontFamily: dm500 } : null]}>
                  {t('parent.application.captureReminderTimeTitle')}
                </Text>
                <Text style={[styles.reminderTimeValue, dm700 ? { fontFamily: dm700 } : null]}>
                  {eveningReminderTime}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {/*
          Incomplete : opacity réduite mais pressable (scale + haptic) —
          pas de `disabled` qui coupe le feedback.
        */}
        <PetitmoPrimaryPressable
          style={[
            petitmoCtaStyles.primaryFullWidth,
            !formComplete && !isCreating ? petitmoCtaStyles.primaryDisabled : null,
          ]}
          onPress={() => void handleContinue()}
          disabled={isCreating}
          activeOpacity={0.9}
          accessibilityLabel={t('createChild.continue')}
        >
          {isCreating ? (
            <ActivityIndicator color={PETITMO_CTA_SPINNER_COLOR} />
          ) : (
            <Text style={[petitmoCtaStyles.primaryText, dm600 ? { fontFamily: dm600 } : null]}>
              {t('createChild.continue')}
            </Text>
          )}
        </PetitmoPrimaryPressable>
      </ScrollView>

      <CropModal
        visible={cropVisible}
        imageUri={rawImageUri ?? ''}
        onCancel={() => {
          setCropVisible(false);
          setRawImageUri(null);
        }}
        onConfirm={(croppedUri) => {
          setCropVisible(false);
          setRawImageUri(null);
          setPhotoUri(croppedUri);
        }}
        onChangePhoto={() => {
          void openImagePickerForCrop();
        }}
      />
      <CaptureReminderTimeSheet
        visible={timeSheetOpen}
        selectedTime={eveningReminderTime}
        onSelect={time => {
          setEveningReminderTime(snapCaptureReminderTimeToSlot(time));
        }}
        onClose={() => setTimeSheetOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  fontsGate: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: verticalScale(40),
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: verticalScale(12),
  },
  backButton: {
    width: scale(44),
    height: scale(44),
    justifyContent: 'center',
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: '700',
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: verticalScale(32),
  },
  titleWithHint: {
    marginBottom: verticalScale(10),
  },
  missingHint: {
    textAlign: 'center',
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    color: THEME.textPrimary,
    lineHeight: scale(22),
    paddingHorizontal: SPACING.sm,
    marginBottom: verticalScale(24),
  },
  photoSection: {
    alignItems: 'center',
    marginBottom: verticalScale(32),
  },
  photoPlaceholder: {
    width: scale(112),
    height: scale(112),
    borderRadius: scale(56),
    backgroundColor: 'rgba(208, 98, 53, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(16),
  },
  photoPreview: {
    width: scale(112),
    height: scale(112),
    borderRadius: scale(56),
    marginBottom: verticalScale(16),
  },
  photoErrorRing: {
    borderWidth: 1.5,
    borderColor: '#E5484D',
  },
  addPhotoText: {
    fontSize: FONT_SIZES.base,
    color: THEME.brandPrimary,
    fontWeight: '600',
    marginBottom: verticalScale(8),
  },
  formSection: {
    marginBottom: verticalScale(48),
  },
  inputGroup: {
    marginBottom: verticalScale(20),
  },
  label: {
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    fontWeight: '600',
    marginBottom: verticalScale(10),
  },
  input: {
    backgroundColor: THEME.bg,
    borderWidth: 1,
    borderColor: THEME.familyFlowLine,
    borderRadius: scale(100),
    paddingHorizontal: SPACING.md,
    paddingVertical: verticalScale(16),
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    // iOS : le letterSpacing de l’écran OTP peut fuiter vers les TextInput suivants.
    letterSpacing: 0,
  },
  inputError: {
    borderColor: '#E5484D',
    borderWidth: 1.5,
  },
  reminderBlock: {
    marginTop: verticalScale(8),
    paddingTop: verticalScale(18),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.familyFlowLine,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  reminderCopy: {
    flex: 1,
  },
  reminderLabel: {
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    marginBottom: verticalScale(4),
  },
  reminderHint: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    lineHeight: scale(20),
  },
  reminderTimeRow: {
    marginTop: verticalScale(14),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: verticalScale(12),
    paddingHorizontal: SPACING.md,
    borderRadius: scale(14),
    backgroundColor: 'rgba(81,84,94,0.06)',
  },
  reminderTimeLabel: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
  },
  reminderTimeValue: {
    fontSize: FONT_SIZES.base,
    color: THEME.captureScreenCtaBackground,
  },
});
