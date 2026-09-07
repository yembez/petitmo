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
  useWindowDimensions,
} from 'react-native';
import { useState, useCallback } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ImageIcon } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, ICON_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { createChild, setSelectedChild } from '@/services/children';
import { signOutRealAccount } from '@/lib/authAccount';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import DatePicker from '@/components/DatePicker';
import PetitCoeurLogo, { PETIT_COEUR_LOGO_VIEWBOX } from '@/components/PetitCoeurLogo';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { CHILD_PROFILE_PHOTO_ASPECT } from '@/utils/captureHeroMetrics';

/** Même ratio que carte Capturer / CropModal (évite 4:5 ≠ 0.93). */
const CREATE_CHILD_PHOTO_ASPECT: [number, number] = [
  Math.round(CHILD_PROFILE_PHOTO_ASPECT * 100),
  100,
];

export default function CreateChildScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ intent?: string }>();
  const authIntent =
    (Array.isArray(params.intent) ? params.intent[0] : params.intent) === 'subscribe'
      ? 'subscribe'
      : undefined;
  const insets = useSafeAreaInsets();
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const { height: windowH } = useWindowDimensions();
  const [childName, setChildName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [backBusy, setBackBusy] = useState(false);

  const handleBack = useCallback(async () => {
    if (backBusy) return;
    setBackBusy(true);
    try {
      const uid = peekLastRealAuthUserId();
      const localCount = uid ? listLocalChildrenForUser(uid).length : 0;
      // Ajout d’un enfant depuis l’app (profils déjà présents) : retour normal.
      if (localCount > 0 && router.canGoBack()) {
        router.back();
        return;
      }
      await signOutRealAccount();
      router.replace({
        pathname: '/auth',
        params: {
          mode: 'signup',
          ...(authIntent ? { intent: authIntent } : {}),
        },
      });
    } catch (e) {
      console.warn('[create-child] handleBack', e);
      router.replace({
        pathname: '/auth',
        params: {
          mode: 'signup',
          ...(authIntent ? { intent: authIntent } : {}),
        },
      });
    } finally {
      setBackBusy(false);
    }
  }, [authIntent, backBusy, router]);

  /** PHPicker : pas de demande d’accès photothèque, la sélection suffit. */
  const handlePhotoUpload = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: CREATE_CHILD_PHOTO_ASPECT,
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  };

  const handleContinue = async () => {
    if (!childName.trim() || !birthDate.trim()) return;

    try {
      setIsCreating(true);

      const child = await createChild(childName.trim(), birthDate, photoUri || undefined);

      if (child) {
        await setSelectedChild(child.id);
        router.replace('/(tabs)');
      } else {
        Alert.alert('Erreur', 'Impossible de créer le profil de l\'enfant');
      }
    } catch (error) {
      console.error('Error creating child:', error);
      Alert.alert('Erreur', 'Une erreur est survenue');
    } finally {
      setIsCreating(false);
    }
  };

  const canContinue = !!childName.trim() && !!birthDate.trim();

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
            accessibilityLabel="Retour"
            disabled={backBusy}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <ChevronLeft size={ICON_SIZES.lg} color={THEME.textPrimary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <View style={styles.logoContainer}>
          <PetitCoeurLogo
            width={scale(180)}
            height={scale(180) * (PETIT_COEUR_LOGO_VIEWBOX.height / PETIT_COEUR_LOGO_VIEWBOX.width)}
            color={THEME.textPrimary}
          />
        </View>

        <Text style={[styles.title, dm700 ? { fontFamily: dm700 } : null]}>
          Créer le profil de ton enfant
        </Text>

        <View style={styles.photoSection}>
          {photoUri ? (
            <TouchableOpacity onPress={handlePhotoUpload} activeOpacity={0.8}>
              <Image source={{ uri: photoUri }} style={styles.photoPreview} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handlePhotoUpload}
              style={styles.photoPlaceholder}
              activeOpacity={0.8}
            >
              <ImageIcon size={ICON_SIZES.xl} color={THEME.textMuted} strokeWidth={2} />
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={handlePhotoUpload} activeOpacity={0.7}>
            <Text style={[styles.addPhotoText, dm500 ? { fontFamily: dm500 } : null]}>Ajouter une photo</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.formSection}>
          <View style={styles.inputGroup}>
            <Text style={[styles.label, dm500 ? { fontFamily: dm500 } : null]}>Prénom de l'enfant</Text>
            <TextInput
              style={[styles.input, dm500 ? { fontFamily: dm500 } : null]}
              value={childName}
              onChangeText={setChildName}
              placeholder="Prénom ou prénoms composés"
              placeholderTextColor={THEME.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, dm500 ? { fontFamily: dm500 } : null]}>
              Date de naissance
            </Text>
            <DatePicker
              value={birthDate}
              onChange={setBirthDate}
              placeholder="JJ/MM/AAAA"
            />
          </View>
        </View>

        <PetitmoPrimaryPressable
          style={petitmoCtaStyles.primaryFullWidth}
          onPress={handleContinue}
          disabled={!canContinue || isCreating}
          activeOpacity={0.9}
        >
          {isCreating ? (
            <ActivityIndicator color={PETITMO_CTA_SPINNER_COLOR} />
          ) : (
            <Text style={[petitmoCtaStyles.primaryText, dm600 ? { fontFamily: dm600 } : null]}>
              Continuer
            </Text>
          )}
        </PetitmoPrimaryPressable>
      </ScrollView>
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
  logoContainer: {
    alignItems: 'center',
    marginBottom: verticalScale(24),
  },
  title: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '700',
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: verticalScale(32),
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
  addPhotoText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.brandCtaOrange,
    fontWeight: '500',
    marginBottom: verticalScale(8),
  },
  laterText: {
    fontSize: scale(13),
    color: '#B8B2A8',
  },
  formSection: {
    marginBottom: verticalScale(48),
  },
  inputGroup: {
    marginBottom: verticalScale(20),
  },
  label: {
    fontSize: scale(13),
    color: THEME.textMuted,
    fontWeight: '500',
    marginBottom: verticalScale(8),
  },
  input: {
    backgroundColor: THEME.bg,
    borderWidth: 1,
    borderColor: THEME.familyFlowLine,
    borderRadius: scale(100),
    paddingHorizontal: SPACING.md,
    paddingVertical: verticalScale(14),
    fontSize: FONT_SIZES.md,
    color: THEME.textPrimary,
    // iOS : le letterSpacing de l’écran OTP peut fuiter vers les TextInput suivants.
    letterSpacing: 0,
  },
});
