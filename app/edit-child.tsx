import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Keyboard,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowLeft, Camera, Menu, Trash2 } from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING, FONT_SIZES, PROFILE_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import { getLocalChild, listLocalChildren } from '@/lib/localDb';
import {
  deleteChild,
  getChildren,
  setSelectedChild,
  updateChild,
  uploadChildPhoto,
  sanitizeChildLocalAvatarIfMissing,
  refreshChildProfileFromLocal,
  refreshChildrenFromCloudInBackground,
  notifyChildProfileUpdated,
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
import { normalizeChildGivenName } from '@/utils/childDisplayName';
import { ChildAvatar } from '@/components/ChildAvatar';

export default function EditChildScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const params = useLocalSearchParams();
  const [child, setChild] = useState<Child | null>(null);
  const [name, setName] = useState('');
  const [birthdate, setBirthdate] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [childrenCount, setChildrenCount] = useState(1);
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

  useFocusEffect(
    useCallback(() => {
      const id = (typeof params.childId === 'string' ? params.childId : child?.id)?.trim();
      if (!id) return;
      void refreshChildProfileFromLocal(id).then(row => {
        if (row) setChild(row);
      });
    }, [params.childId, child?.id]),
  );

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardInset(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardInset(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const loadChild = async () => {
    const childId = typeof params.childId === 'string' ? params.childId.trim() : '';
    const applyRow = async (currentChild: Child, count: number) => {
      setChildrenCount(count);
      await setSelectedChild(currentChild.id);
      const cleaned =
        Platform.OS === 'web'
          ? currentChild
          : await sanitizeChildLocalAvatarIfMissing(currentChild);
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
      try {
        const stored = await AsyncStorage.getItem(originalPhotoKey(cleaned.id));
        setOriginalPhotoUri((stored ?? resolved).trim());
      } catch {
        setOriginalPhotoUri(resolved.trim());
      }
    };

    try {
      const localRow = childId ? getLocalChild(childId) : null;
      const localList = listLocalChildren();

      if (localRow) {
        setIsLoading(false);
        await applyRow(localRow, localList.length || 1);
        refreshChildrenFromCloudInBackground();
        void getChildren()
          .then(children => {
            setChildrenCount(children.length);
            const next = children.find(c => c.id === childId);
            if (next) void applyRow(next, children.length);
          })
          .catch(() => {});
        return;
      }

      setIsLoading(true);
      const children = await getChildren();
      setChildrenCount(children.length);
      const currentChild = children.find(c => c.id === childId);
      if (currentChild) {
        await applyRow(currentChild, children.length);
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
      await uploadChildPhoto(child.id, uri);
      const cur = getLocalChild(child.id);
      if (!cur) {
        Alert.alert('Erreur', 'Profil introuvable');
        return;
      }
      setChild(cur);
      const display = resolveChildProfileImageUri(cur.local_photo_path, cur.photo_url) ?? '';
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
    if (!birthdate.trim()) {
      Alert.alert('Erreur', 'La date de naissance est requise');
      return;
    }

    try {
      setIsSaving(true);
      const updates = {
        name: normalizeChildGivenName(name),
        birthdate: birthdate.trim(),
      };
      const updated =
        (await getCachedUserMode()) === 'local'
          ? await updateChild(child.id, updates)
          : await updateChild(child.id, {
              ...updates,
              /** Toujours l’URL Supabase / signée — `photoUrl` peut être un `file://` après persistance sandbox. */
              photo_url: (child.photo_url ?? '').trim() || null,
            });
      setChild(updated);
      notifyChildProfileUpdated(updated.id, updated);
      router.back();
    } catch (error) {
      console.error('Error updating child:', error);
      Alert.alert('Erreur', 'Impossible de sauvegarder les modifications');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = () => {
    if (!child || isDeleting) return;

    const isLastChild = childrenCount <= 1;
    const childName = normalizeChildGivenName(name) || child.name;

    Alert.alert(
      isLastChild ? 'Supprimer ce profil et tous vos souvenirs ?' : 'Supprimer ce profil ?',
      isLastChild
        ? "C'est ton dernier profil enfant. Tous vos souvenirs et livres seront définitivement supprimés de cet appareil."
        : `Le profil de ${childName} sera supprimé. Vos souvenirs restent dans le fil famille.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                setIsDeleting(true);
                const result = await deleteChild(child.id);
                if (result.wasLastChild) {
                  router.replace('/create-child');
                } else {
                  router.back();
                }
              } catch (error) {
                console.error('Error deleting child:', error);
                Alert.alert('Erreur', 'Impossible de supprimer ce profil');
              } finally {
                setIsDeleting(false);
              }
            })();
          },
        },
      ],
    );
  };

  const canSave = !!name.trim() && !!birthdate.trim();

  if (!fontsLoaded) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={THEME.textPrimary} />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={THEME.textPrimary} />
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

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={{
          paddingBottom:
            Math.max(insets.bottom, verticalScale(16)) + keyboardInset + verticalScale(24),
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.photoSection}>
          <TouchableOpacity
            onPress={() => void openCropOnCurrentPhoto()}
            disabled={isUploadingPhoto || isPreparingCrop}
            style={styles.photoContainer}
          >
            {child ? (
              <ChildAvatar
                key={`${child.id}-${child.updated_at ?? ''}-${child.local_photo_path ?? ''}`}
                child={child}
                size={PROFILE_SIZES.large}
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
              placeholder="Prénom ou prénoms composés"
              placeholderTextColor={THEME.textMuted}
              autoCapitalize="words"
              autoCorrect={false}
              onFocus={() => {
                requestAnimationFrame(() => {
                  scrollRef.current?.scrollTo({ y: 0, animated: true });
                });
              }}
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
          style={[
            petitmoCtaStyles.primary,
            petitmoCtaStyles.primaryFullWidth,
            styles.saveButton,
            (isSaving || isDeleting || !canSave) && petitmoCtaStyles.primaryDisabled,
          ]}
          onPress={handleSave}
          disabled={isSaving || isDeleting || !canSave}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={PETITMO_CTA_SPINNER_COLOR} />
          ) : (
            <Text style={[petitmoCtaStyles.primaryText, dm600 ? { fontFamily: dm600 } : null]}>
              Enregistrer
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.deleteButton, (isSaving || isDeleting) && styles.deleteButtonDisabled]}
          onPress={handleDelete}
          disabled={isSaving || isDeleting}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Supprimer ce profil enfant"
        >
          {isDeleting ? (
            <ActivityIndicator size="small" color="#FF3B30" />
          ) : (
            <>
              <Trash2 size={scale(18)} color="#FF3B30" strokeWidth={2} />
              <Text style={[styles.deleteButtonText, dm500 ? { fontFamily: dm500 } : null]}>
                Supprimer ce profil
              </Text>
            </>
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
    backgroundColor: THEME.bg,
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
    width: PROFILE_SIZES.large,
    height: PROFILE_SIZES.large,
  },
  photo: {
    width: PROFILE_SIZES.large,
    height: PROFILE_SIZES.large,
    borderRadius: PROFILE_SIZES.large / 2,
  },
  photoPlaceholder: {
    backgroundColor: THEME.brandPrimary,
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
    borderColor: THEME.bg,
  },
  photoIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    backgroundColor: THEME.brandCtaOrange,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: THEME.bg,
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
    letterSpacing: 0,
  },
  hint: {
    fontSize: FONT_SIZES.xs,
    color: '#8791A1',
    marginTop: SPACING.xs,
  },
  saveButton: {
    marginBottom: SPACING.lg,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    marginBottom: SPACING.xl,
  },
  deleteButtonDisabled: {
    opacity: 0.5,
  },
  deleteButtonText: {
    fontSize: FONT_SIZES.base,
    color: '#FF3B30',
    fontWeight: '500',
  },
});
