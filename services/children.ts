import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { copyAsync, documentDirectory, makeDirectoryAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { Database } from '@/types/database';
import type { Child as LocalChild } from '@/types/local';
import { getCachedUserMode } from '@/lib/userMode';
import { getLocalChild, listLocalChildren, upsertLocalChild } from '@/lib/localDb';

type ChildRow = Database['public']['Tables']['children']['Row'];

function withLocalChildFields(row: ChildRow): LocalChild {
  return { ...row, local_photo_path: null };
}

function newLocalChildId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `ch_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

let captureTabChildSnapshotLocal: LocalChild | null = null;

export function getCaptureTabChildSnapshot(): LocalChild | null {
  return captureTabChildSnapshotLocal;
}

export function setCaptureTabChildSnapshot(row: LocalChild | null): void {
  captureTabChildSnapshotLocal = row;
}

const SELECTED_CHILD_KEY = '@petitmo_selected_child';

export async function getChildren() {
  try {
    if ((await getCachedUserMode()) === 'local') {
      return listLocalChildren();
    }

    const { data, error } = await supabase
      .from('children')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    return (data || []).map(withLocalChildFields);
  } catch (error) {
    console.error('Get children error:', error);
    return [];
  }
}

/**
 * Téléverse la photo de profil (Petitmo+) ou la copie en sandbox (`petitmo_children/`, gratuit local).
 * @returns URL publique (cloud) ou `file://` / chemin local (mode local)
 */
export async function uploadChildPhoto(childId: string, photoUri: string): Promise<string> {
  try {
    if ((await getCachedUserMode()) === 'local') {
      if (!documentDirectory) {
        throw new Error('Stockage local indisponible (documentDirectory).');
      }
      const root = `${documentDirectory}petitmo_children/`;
      await makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
      const ext =
        (photoUri.split('?')[0] ?? '').split('.').pop()?.toLowerCase() || 'jpg';
      const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext) ? ext : 'jpg';
      const dest = `${root}${childId}.${safeExt}`;
      await copyAsync({ from: photoUri.trim(), to: dest });
      const cur = getLocalChild(childId);
      if (!cur) {
        throw new Error('Enfant introuvable en local');
      }
      const now = new Date().toISOString();
      const next: LocalChild = {
        ...cur,
        local_photo_path: dest,
        photo_url: null,
        updated_at: now,
      };
      upsertLocalChild(next);
      return dest;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const fileExt = photoUri.split('.').pop()?.toLowerCase() || 'jpg';
    const fileName = `${childId}-${Date.now()}.${fileExt}`;
    const filePath = `${user.id}/children/${fileName}`;

    let fileData: Blob | Uint8Array;

    if (Platform.OS === 'web') {
      const response = await fetch(photoUri);
      fileData = await response.blob();
    } else {
      const file = new FileSystem.File(photoUri);
      fileData = await file.bytes();
    }

    const { error } = await supabase.storage
      .from('media')
      .upload(filePath, fileData, {
        contentType: `image/${fileExt}`,
        upsert: true,
      });

    if (error) throw error;

    const { data, error: signErr } = await supabase.storage
      .from('media')
      .createSignedUrl(filePath, 60 * 60 * 24 * 7);
    if (signErr || !data?.signedUrl) {
      throw signErr ?? new Error('Impossible de signer la photo enfant');
    }
    return data.signedUrl;
  } catch (error) {
    console.error('Upload child photo error:', error);
    throw error;
  }
}

export async function createChild(name: string, birthdate?: string, photoUri?: string) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('User not authenticated');

    const birthdateValue = birthdate && birthdate.trim() ? birthdate.trim() : '2020-01-01';

    if ((await getCachedUserMode()) === 'local') {
      const id = newLocalChildId();
      const now = new Date().toISOString();
      let localPhotoPath: string | null = null;
      if (photoUri?.trim() && documentDirectory) {
        const root = `${documentDirectory}petitmo_children/`;
        await makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
        const ext = photoUri.split('?')[0]?.split('.').pop()?.toLowerCase() || 'jpg';
        const dest = `${root}${id}.${ext}`;
        try {
          await copyAsync({ from: photoUri.trim(), to: dest });
          localPhotoPath = dest;
        } catch (e) {
          console.warn('[children] local profile photo copy failed', e);
        }
      } else if (photoUri?.trim() && Platform.OS === 'web') {
        // TODO: persistance profil enfant côté web en mode local (V1 cible plutôt iOS ; pas de documentDirectory)
      }
      const row: LocalChild = {
        id,
        user_id: user.id,
        name,
        birthdate: birthdateValue,
        photo_url: null,
        created_at: now,
        updated_at: now,
        local_photo_path: localPhotoPath,
      };
      upsertLocalChild(row);
      return row;
    }

    const payload: Database['public']['Tables']['children']['Insert'] = {
      user_id: user.id,
      name,
      birthdate: birthdateValue,
    };

    const { data, error } = await supabase
      .from('children')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;

    if (photoUri && data) {
      try {
        const photoUrl = await uploadChildPhoto(data.id, photoUri);
        const { data: updatedChild, error: updateError } = await supabase
          .from('children')
          .update({ photo_url: photoUrl })
          .eq('id', data.id)
          .select()
          .single();

        if (!updateError && updatedChild) {
          return updatedChild;
        }
      } catch (photoError) {
        console.error('Error uploading photo, continuing without photo:', photoError);
      }
    }

    return data;
  } catch (error) {
    console.error('Create child error:', error);
    return null;
  }
}

export async function setSelectedChild(childId: string) {
  try {
    await AsyncStorage.setItem(SELECTED_CHILD_KEY, childId);
  } catch (error) {
    console.error('Set selected child error:', error);
  }
}

export async function getSelectedChild(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(SELECTED_CHILD_KEY);
  } catch (error) {
    console.error('Get selected child error:', error);
    return null;
  }
}

export async function getOrSelectFirstChild(): Promise<string | null> {
  try {
    /** Toujours partir de la liste serveur : évite « aucun enfant » si AsyncStorage vide / ID obsolète alors qu’il existe des profils. */
    const children = await getChildren();
    if (!children.length) {
      return null;
    }

    const stored = await getSelectedChild();
    if (stored && children.some(c => c.id === stored)) {
      return stored;
    }

    const firstId = children[0].id;
    await setSelectedChild(firstId);
    return firstId;
  } catch (error) {
    console.error('Get or select first child error:', error);
    return null;
  }
}

export async function updateChild(
  childId: string,
  updates: {
    name?: string;
    birthdate?: string | null;
    photo_url?: string | null;
    local_photo_path?: string | null;
  }
) {
  try {
    if ((await getCachedUserMode()) === 'local') {
      const cur = getLocalChild(childId);
      if (!cur) throw new Error('Child not found locally');
      const next: LocalChild = {
        ...cur,
        ...updates,
        birthdate:
          updates.birthdate !== undefined ? updates.birthdate ?? '' : cur.birthdate,
        updated_at: new Date().toISOString(),
      };
      upsertLocalChild(next);
      return next;
    }

    const { data, error } = await supabase
      .from('children')
      .update(updates)
      .eq('id', childId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Update child error:', error);
    throw error;
  }
}
