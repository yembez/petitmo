import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect } from 'react';
import { ArrowLeft, Camera, Menu } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, PROFILE_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { getLocalChild } from '@/lib/localDb';
import {
  getChildren,
  setSelectedChild,
  updateChild,
  uploadChildPhoto,
  sanitizeChildLocalAvatarIfMissing,
  resolveChildAvatarCropSourceUri,
} from '@/services/children';
import { getCachedUserMode } from '@/lib/userMode';
import type { Child } from '@/types/local';
import {
  resolveChildProfileImageUri,
  resolveChildProfileImageDisplayUri,
} from '@/utils/childPhotoUri';
import DatePicker from '@/components/DatePicker';
import { CropModal } from '@/components/CropModal';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';

export default function EditChildScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const params = useLocalSearchParams();
  const [child, setChild] = useState<Child | null>(null);
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isPreparingCrop, setIsPreparingCrop] = useState(false);
  const [cropVisible, setCropVisible] = useState(false);
  const [rawImageUri, setRawImageUri] = useState<string | null>(null);
  /** Source “originale” pour ré-ouvrir le recadrage même après upload du crop. */
  const [originalPhotoUri, setOriginalPhotoUri] = useState<string>('');

  const originalPhotoKey = (childId: string) => `@petitmo_child_original_photo_v1:${childId}`;

  useEffect(() => {
    loadChild();
  }, []);

  const loadChild = async () => {
    try {
      setIsLoading(true);
      const children = await getChildren();
      const currentChild = children.find(c => c.id === params.childId);

      if (currentChild) {
        await setSelectedChild(currentChild.id);
        const cleaned = await sanitizeChildLocalAvatarIfMissing(currentChild);
        setChild(cleaned);
        setName(cleaned.name);
        setBirthdate(cleaned.birthdate || '');
        const resolved =
          resolveChildProfileImageDisplayUri(
            cleaned.local_photo_path,
            cleaned.photo_url,
            cleaned.updated_at,
          ) ??
          resolveChildProfileImageUri(cleaned.local_photo_path, cleaned.photo_url) ??
          '';
        setPhotoUrl(resolved);
        // Récupère la source “originale” si dispo, sinon photo affichable (local ou URL).
        try {
          const stored = await AsyncStorage.getItem(originalPhotoKey(cleaned.id));
          setOriginalPhotoUri((stored ?? resolved).trim());
        } catch {
          setOriginalPhotoUri(resolved.trim());
        }
      }
    } catch (error) {
      console.error('Error loading child:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const openImagePickerForCrop = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 1,
    });

    if (!result.canceled && result.assets[0]) {
      const picked = result.assets[0].uri;
      setRawImageUri(picked);
      setCropVisible(true);
      // Persist la nouvelle source originale pour les prochains recadrages.
      if (child?.id) {
        setOriginalPhotoUri(picked);
        try {
          await AsyncStorage.setItem(originalPhotoKey(child.id), picked);
        } catch {
          /* */
        }
      }
    }
  };

  const openCropOnCurrentPhoto = async () => {
    const uri = (originalPhotoUri || photoUrl || '').trim();
    if (!uri) {
      await openImagePickerForCrop();
      return;
    }
    try {
      setIsPreparingCrop(true);
      if (!child) return;
      const resolved = await resolveChildAvatarCropSourceUri(child, uri);
      if (!resolved) {
        await openImagePickerForCrop();
        return;
      }
      setRawImageUri(resolved);
      setCropVisible(true);
    } finally {
      setIsPreparingCrop(false);
    }
  };

  const uploadPhoto = async (uri: string) => {
    if (!child) return;

    try {
      setIsUploadingPhoto(true);
      const url = await uploadChildPhoto(child.id, uri);
      const cur = getLocalChild(child.id);
      if (!cur) {
        Alert.alert('Erreur', 'Profil introuvable');
        return;
      }
      const cleaned = await sanitizeChildLocalAvatarIfMissing(cur);
      setChild(cleaned);
      const display =
        Platform.OS !== 'web'
          ? resolveChildProfileImageDisplayUri(
              cleaned.local_photo_path,
              cleaned.photo_url,
              cleaned.updated_at,
            ) ??
            resolveChildProfileImageUri(cleaned.local_photo_path, cleaned.photo_url) ??
            url
          : (resolveChildProfileImageUri(cleaned.local_photo_path, cleaned.photo_url) ?? url);
      setPhotoUrl(display);
    } catch (error) {
      console.error('Error uploading photo:', error);
      Alert.alert('Erreur', 'Impossible de télécharger la photo');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleSave = async () => {
    if (!child || !name.trim()) {
      Alert.alert('Erreur', 'Le nom est requis');
      return;
    }

    try {
      setIsSaving(true);
      if ((await getCachedUserMode()) === 'local') {
        // Photo déjà persistée (sandbox + SQLite) par `uploadChildPhoto` en mode local
        await updateChild(child.id, {
          name: name.trim(),
          birthdate: birthdate || null,
        });
      } else {
        await updateChild(child.id, {
          name: name.trim(),
          birthdate: birthdate || null,
          /** Toujours l’URL Supabase / signée — `photoUrl` peut être un `file://` après persistance sandbox. */
          photo_url: (child.photo_url ?? '').trim() || null,
        });
      }
      router.back();
    } catch (error) {
      console.error('Error updating child:', error);
      Alert.alert('Erreur', 'Impossible de sauvegarder les modifications');
    } finally {
      setIsSaving(false);
    }
  };

  if (!fontsLoaded) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={THEME.brandTerracotta} />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={THEME.brandTerracotta} />
      </View>
    );
  }

  if (!child) {
    return null;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <ArrowLeft size={24} color={THEME.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, dm600 ? { fontFamily: dm600 } : null]}>Modifier le profil</Text>
        <TouchableOpacity
          onPress={() => router.push('/parent-space')}
          style={styles.backButton}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Menu"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Menu size={scale(22)} color={THEME.textPrimary} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.photoSection}>
          <TouchableOpacity
            onPress={() => void openCropOnCurrentPhoto()}
            disabled={isUploadingPhoto || isPreparingCrop}
            style={styles.photoContainer}
          >
            {photoUrl ? (
              <Image
                source={{ uri: photoUrl }}
                style={styles.photo}
              />
            ) : (
              <View style={[styles.photo, styles.photoPlaceholder]}>
                <Text style={[styles.photoPlaceholderText, dm700 ? { fontFamily: dm700 } : null]}>
                  {name.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            {isUploadingPhoto ? (
              <View style={styles.photoOverlay}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : isPreparingCrop ? (
              <View style={styles.photoOverlay}>
                <ActivityIndicator size="small" color="#FFFFFF" />
              </View>
            ) : (
              <View style={styles.photoIconContainer}>
                <Camera size={20} color="#FFFFFF" strokeWidth={2} />
              </View>
            )}
          </TouchableOpacity>
          <Text style={[styles.photoHint, dm500 ? { fontFamily: dm500 } : null]}>Appuyez pour recadrer</Text>
        </View>

        <View style={styles.formSection}>
          <View style={styles.inputGroup}>
            <Text style={[styles.label, dm500 ? { fontFamily: dm500 } : null]}>Prénom</Text>
            <TextInput
              style={[styles.input, dm500 ? { fontFamily: dm500 } : null]}
              value={name}
              onChangeText={setName}
              placeholder="Prénom de l'enfant"
              placeholderTextColor={THEME.textMuted}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={[styles.label, dm500 ? { fontFamily: dm500 } : null]}>Date de naissance</Text>
            <DatePicker
              value={birthdate}
              onChange={setBirthdate}
              placeholder="JJ/MM/AAAA"
            />
          </View>
        </View>

        <TouchableOpacity
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={[styles.saveButtonText, dm600 ? { fontFamily: dm600 } : null]}>Enregistrer</Text>
          )}
        </TouchableOpacity>
      </ScrollView>

      <CropModal
        visible={cropVisible}
        imageUri={rawImageUri ?? ''}
        onCancel={() => {
          setCropVisible(false);
          setRawImageUri(null);
        }}
        onConfirm={async (croppedUri) => {
          setCropVisible(false);
          setRawImageUri(null);
          await uploadPhoto(croppedUri);
        }}
        onChangePhoto={() => {
          // Ne ferme pas le modal : remplace simplement l'image en relançant la galerie.
          void openImagePickerForCrop();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.familyFlowScreenBg,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: THEME.familyFlowLine,
  },
  backButton: {
    width: scale(40),
    height: scale(40),
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: THEME.textPrimary,
  },
  content: {
    flex: 1,
    paddingHorizontal: SPACING.md,
  },
  photoSection: {
    alignItems: 'center',
    marginTop: SPACING.xl,
    marginBottom: SPACING.xl,
  },
  photoContainer: {
    position: 'relative',
  },
  photo: {
    width: PROFILE_SIZES.large,
    height: PROFILE_SIZES.large,
    borderRadius: PROFILE_SIZES.large / 2,
  },
  photoPlaceholder: {
    backgroundColor: THEME.brandTerracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlaceholderText: {
    fontSize: scale(48),
    color: '#FFFFFF',
    fontWeight: '600',
  },
  photoOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: THEME.familyFlowScreenBg,
  },
  photoIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    backgroundColor: THEME.brandTerracotta,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: THEME.familyFlowScreenBg,
  },
  photoHint: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    marginTop: SPACING.sm,
  },
  formSection: {
    marginBottom: SPACING.xl,
  },
  inputGroup: {
    marginBottom: SPACING.lg,
  },
  label: {
    fontSize: FONT_SIZES.base,
    fontWeight: '500',
    color: THEME.textMuted,
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: THEME.bg,
    borderRadius: scale(100),
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    borderWidth: 1,
    borderColor: THEME.familyFlowLine,
  },
  hint: {
    fontSize: FONT_SIZES.xs,
    color: '#8791A1',
    marginTop: SPACING.xs,
  },
  saveButton: {
    backgroundColor: THEME.brandTerracotta,
    borderRadius: scale(100),
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginBottom: SPACING.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: FONT_SIZES.base,
    fontWeight: '600',
    color: '#FFFFFF',
  },
});
