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
import { ArrowLeft, Camera } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, PROFILE_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { getLocalChild } from '@/lib/localDb';
import { getChildren, setSelectedChild, updateChild, uploadChildPhoto } from '@/services/children';
import { getCachedUserMode } from '@/lib/userMode';
import type { Child } from '@/types/local';
import { resolveChildProfileImageUri } from '@/utils/childPhotoUri';
import DatePicker from '@/components/DatePicker';
import { CropModal } from '@/components/CropModal';
import { ensureLocalImageForPalette } from '@/hooks/ensureLocalImageForPalette';

export default function EditChildScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
        setChild(currentChild);
        setName(currentChild.name);
        setBirthdate(currentChild.birthdate || '');
        const resolved =
          resolveChildProfileImageUri(currentChild.local_photo_path, currentChild.photo_url) ?? '';
        setPhotoUrl(resolved);
        // Récupère la source “originale” si dispo, sinon photo affichable (local ou URL).
        try {
          const stored = await AsyncStorage.getItem(originalPhotoKey(currentChild.id));
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
      const local = await ensureLocalImageForPalette(uri);
      setRawImageUri(local);
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
      const display =
        Platform.OS !== 'web'
          ? resolveChildProfileImageUri(cur?.local_photo_path ?? null, url) ?? url
          : url;
      setPhotoUrl(display);
      setChild(prev =>
        prev && prev.id === child.id
          ? {
              ...prev,
              photo_url: url,
              local_photo_path: cur?.local_photo_path ?? prev.local_photo_path ?? null,
            }
          : prev
      );
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

  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={THEME.accent} />
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
          <ArrowLeft size={24} color="#3F4A5A" strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Modifier le profil</Text>
        <View style={styles.backButton} />
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
                <Text style={styles.photoPlaceholderText}>
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
          <Text style={styles.photoHint}>Appuyez pour recadrer</Text>
        </View>

        <View style={styles.formSection}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Prénom</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Prénom de l'enfant"
              placeholderTextColor="#8791A1"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Date de naissance</Text>
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
            <Text style={styles.saveButtonText}>Enregistrer</Text>
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
    backgroundColor: THEME.bgScreen,
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
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    width: scale(40),
    height: scale(40),
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: '#3F4A5A',
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
    backgroundColor: THEME.accent,
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
    borderColor: THEME.bgScreen,
  },
  photoIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    backgroundColor: THEME.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: THEME.bgScreen,
  },
  photoHint: {
    fontSize: FONT_SIZES.sm,
    color: '#8791A1',
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
    color: '#3F4A5A',
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: scale(100),
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontSize: FONT_SIZES.base,
    color: '#3F4A5A',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  hint: {
    fontSize: FONT_SIZES.xs,
    color: '#8791A1',
    marginTop: SPACING.xs,
  },
  saveButton: {
    backgroundColor: THEME.accent,
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
