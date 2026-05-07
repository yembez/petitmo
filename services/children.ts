import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { copyAsync, documentDirectory, downloadAsync, getInfoAsync, makeDirectoryAsync } from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import type { Database } from '@/types/database';
import type { Child as LocalChild } from '@/types/local';
import { getCachedUserMode } from '@/lib/userMode';
import { getLocalChild, listLocalChildren, upsertLocalChild } from '@/lib/localDb';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import { resolveChildProfileImageUri } from '@/utils/childPhotoUri';
import { ensureLocalImageForPalette } from '@/hooks/ensureLocalImageForPalette';

type ChildRow = Database['public']['Tables']['children']['Row'];

function isChildDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  if (code === '23505') return true;
  const msg = String((error as { message?: string }).message ?? '');
  return /duplicate key|unique constraint/i.test(msg);
}

function withLocalChildFields(row: ChildRow): LocalChild {
  return { ...row, local_photo_path: null };
}

/**
 * Copie la source (picker, crop, fichier sandbox) vers `petitmo_children/{id}.ext` (Petitmo+).
 */
async function copyChildAvatarSourceToSandbox(childId: string, sourceUri: string): Promise<string | null> {
  if (Platform.OS === 'web' || !documentDirectory) return null;
  const root = `${documentDirectory}petitmo_children/`;
  await makeDirectoryAsync(root, { intermediates: true }).catch(() => {});
  const rawExt = (sourceUri.split('?')[0] ?? '').split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(rawExt) ? rawExt : 'jpg';
  const dest = `${root}${childId}.${safeExt}`;
  const src = sourceUri.trim();
  if (!src) return null;
  const norm = (u: string) => u.replace(/^file:\/\//, '');
  if (norm(src) === norm(dest)) {
    return dest;
  }
  try {
    await copyAsync({ from: src, to: dest });
    return dest;
  } catch (e) {
    console.warn('[children] copyChildAvatarSourceToSandbox', childId, e);
    return null;
  }
}

/**
 * Si `local_photo_path` pointe vers un fichier disparu (réinstall, purge sandbox), on nettoie SQLite
 * pour retomber sur `photo_url` et éviter « File is not readable » dans ImageManipulator / Image.
 */
export async function sanitizeChildLocalAvatarIfMissing(child: LocalChild): Promise<LocalChild> {
  if (Platform.OS === 'web') return child;
  const lp = (child.local_photo_path ?? '').trim();
  if (!lp) return child;

  const uri = resolveChildProfileImageUri(lp, null);
  if (!uri?.startsWith('file')) return child;

  try {
    const info = await getInfoAsync(uri);
    if (info.exists && !info.isDirectory) return child;
  } catch {
    /* fichier inaccessible */
  }

  const next: LocalChild = { ...child, local_photo_path: null };
  upsertLocalChild(next);
  return next;
}

/**
 * URI exploitable pour ouvrir le recadrage profil : fichier existant, ou copie cache depuis `photo_url`.
 */
export async function resolveChildAvatarCropSourceUri(
  child: LocalChild,
  preferredUri: string
): Promise<string | null> {
  const pref = preferredUri.trim();
  const remote = (child.photo_url ?? '').trim();

  if (/^https?:\/\//i.test(pref)) {
    try {
      return await ensureLocalImageForPalette(pref);
    } catch {
      return pref || null;
    }
  }

  if (Platform.OS === 'web') return pref || remote || null;

  if (pref) {
    const fsUri = pref.startsWith('file') ? pref : resolveChildProfileImageUri(pref, null) ?? pref;
    try {
      const info = await getInfoAsync(fsUri);
      if (info.exists && !info.isDirectory) return fsUri;
    } catch {
      /* */
    }
  }

  if (remote) {
    try {
      const signed = await getSignedMediaDisplayUrl(remote);
      return await ensureLocalImageForPalette(signed);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Hydratation immédiate onglet Capturer : enfant déjà en SQLite (sans attendre Supabase).
 */
export async function loadCaptureChildFromLocalDbFirst(): Promise<LocalChild | null> {
  const id = await getSelectedChild();
  if (!id?.trim()) return null;
  const row = getLocalChild(id.trim());
  if (!row) return null;
  return sanitizeChildLocalAvatarIfMissing(row);
}

/**
 * Télécharge `photo_url` (URL signée) vers le sandbox pour affichage offline-first du profil.
 */
export async function cacheRemoteChildProfilePhotoLocally(child: LocalChild): Promise<LocalChild> {
  if (Platform.OS === 'web' || !documentDirectory) return child;

  let row = await sanitizeChildLocalAvatarIfMissing(child);

  const remote = (row.photo_url ?? '').trim();
  if (!remote) return row;
  if ((row.local_photo_path ?? '').trim()) return row;

  const dest = `${documentDirectory}petitmo_children/${row.id}.jpg`;
  const root = `${documentDirectory}petitmo_children/`;
  await makeDirectoryAsync(root, { intermediates: true }).catch(() => {});

  let headers: Record<string, string> | undefined;
  try {
    const host = new URL(remote).hostname;
    if (host.includes('supabase')) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) headers = { Authorization: `Bearer ${token}` };
    }
  } catch {
    /* ignore */
  }

  try {
    const signedRemote = await getSignedMediaDisplayUrl(remote);
    const res = await downloadAsync(
      signedRemote,
      dest,
      headers && Object.keys(headers).length ? { headers } : undefined
    );
    if (res.status !== 200) return row;

    const next: LocalChild = {
      ...row,
      local_photo_path: res.uri,
      updated_at: new Date().toISOString(),
    };
    upsertLocalChild(next);
    return next;
  } catch (e) {
    console.warn('[children] cacheRemoteChildProfilePhotoLocally', row.id, e);
    return row;
  }
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

/** Dernier enfant sélectionné : hydratation SQLite **sync** des onglets + cohérence après `setSelectedChild`. */
let selectedChildIdLastKnown: string | null = null;

export function peekSelectedChildIdLastKnown(): string | null {
  return selectedChildIdLastKnown;
}

/** Après `initLocalDb`, avant l’auth : lit AsyncStorage pour que `hydrateTabScreensFromSqliteSync` cible le bon profil. */
export async function warmSelectedChildIdFromStorage(): Promise<void> {
  await getSelectedChild();
}

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
    return (data || []).map(row => {
      const base = withLocalChildFields(row);
      /** Copie sandbox déjà en SQLite (gratuit → payant, etc.) : affichage local-first si dispo. */
      const local = getLocalChild(row.id);
      const lp = (local?.local_photo_path ?? '').trim();
      if (lp) {
        return { ...base, local_photo_path: lp };
      }
      return base;
    });
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
    const signedUrl = data.signedUrl;

    const sandboxPath = await copyChildAvatarSourceToSandbox(childId, photoUri.trim());
    const existing = getLocalChild(childId);
    const now = new Date().toISOString();
    if (sandboxPath) {
      if (existing) {
        upsertLocalChild({
          ...existing,
          photo_url: signedUrl,
          local_photo_path: sandboxPath,
          updated_at: now,
        });
      } else {
        const { data: row, error: fetchErr } = await supabase
          .from('children')
          .select('*')
          .eq('id', childId)
          .single();
        if (!fetchErr && row) {
          upsertLocalChild({
            ...withLocalChildFields(row),
            photo_url: signedUrl,
            local_photo_path: sandboxPath,
            updated_at: now,
          });
        }
      }
    } else if (existing) {
      upsertLocalChild({
        ...existing,
        photo_url: signedUrl,
        updated_at: now,
      });
    }

    return signedUrl;
  } catch (error) {
    console.error('Upload child photo error:', error);
    throw error;
  }
}

async function syncChildProfilePhotoFromLocalIfNeeded(child: LocalChild): Promise<void> {
  const lp = (child.local_photo_path ?? '').trim();
  const hasRemotePhoto = !!(child.photo_url ?? '').trim();
  if (!lp || hasRemotePhoto) return;
  try {
    const url = await uploadChildPhoto(child.id, lp);
    const { error: upErr } = await supabase.from('children').update({ photo_url: url }).eq('id', child.id);
    if (upErr) {
      console.warn('[children] syncChildProfilePhotoFromLocalIfNeeded', child.id, upErr.message);
      return;
    }
    const cur = getLocalChild(child.id);
    if (cur) {
      upsertLocalChild({ ...cur, photo_url: url });
    }
  } catch (e) {
    console.warn('[children] syncChildProfilePhotoFromLocalIfNeeded', child.id, e);
  }
}

/**
 * Après passage en Petitmo+ : les profils enfants existent en SQLite (mode gratuit).
 * Les insère sur Supabase **avec le même `id`** pour que `memories.child_id` reste valide.
 * Idempotent si la ligne existe déjà (contrainte unique).
 */
export async function ensureLocalChildrenSyncedToSupabase(): Promise<void> {
  if ((await getCachedUserMode()) !== 'cloud') return;

  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return;

  const locals = listLocalChildren();
  if (locals.length === 0) return;

  for (const child of locals) {
    const insert: Database['public']['Tables']['children']['Insert'] = {
      id: child.id,
      user_id: user.id,
      name: child.name,
      birthdate: child.birthdate,
      photo_url: child.photo_url ?? null,
      created_at: child.created_at,
      updated_at: child.updated_at ?? child.created_at,
    };

    const { error } = await supabase.from('children').insert(insert);
    if (error) {
      if (isChildDuplicateKeyError(error)) {
        await syncChildProfilePhotoFromLocalIfNeeded(child);
        continue;
      }
      console.warn('[children] ensureLocalChildrenSyncedToSupabase insert', child.id, error.message);
      continue;
    }

    await syncChildProfilePhotoFromLocalIfNeeded(child);
  }
}

/**
 * Export livre/PDF (y compris plan gratuit) : assure une ligne `children` sur Supabase pour la FK `memories.child_id`.
 */
export async function ensureChildRowExistsOnSupabaseForExport(childId: string): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return;

  const local = getLocalChild(childId);
  if (!local) return;

  const insert: Database['public']['Tables']['children']['Insert'] = {
    id: local.id,
    user_id: user.id,
    name: local.name,
    birthdate: local.birthdate,
    photo_url: local.photo_url ?? null,
    created_at: local.created_at,
    updated_at: local.updated_at ?? local.created_at,
  };

  const { error } = await supabase.from('children').insert(insert);
  if (error) {
    if (isChildDuplicateKeyError(error)) {
      if ((await getCachedUserMode()) === 'cloud') {
        await syncChildProfilePhotoFromLocalIfNeeded(local);
      }
      return;
    }
    console.warn('[children] ensureChildRowExistsOnSupabaseForExport', childId, error.message);
    return;
  }

  if ((await getCachedUserMode()) === 'cloud') {
    await syncChildProfilePhotoFromLocalIfNeeded(local);
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
  const id = childId.trim();
  selectedChildIdLastKnown = id || null;
  try {
    await AsyncStorage.setItem(SELECTED_CHILD_KEY, id);
  } catch (error) {
    console.error('Set selected child error:', error);
  }
}

export async function getSelectedChild(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(SELECTED_CHILD_KEY);
    const t = v?.trim() || null;
    selectedChildIdLastKnown = t;
    return t;
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
    if (!data) throw new Error('Update failed');

    const base = withLocalChildFields(data as ChildRow);
    const local = getLocalChild(childId);
    const lp = (local?.local_photo_path ?? '').trim();
    const next: LocalChild = {
      ...base,
      local_photo_path: lp || null,
      updated_at: data.updated_at ?? base.updated_at,
    };
    upsertLocalChild(next);
    return next;
  } catch (error) {
    console.error('Update child error:', error);
    throw error;
  }
}
