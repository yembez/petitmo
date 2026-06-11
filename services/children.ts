import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import {
  copyAsync,
  deleteAsync,
  documentDirectory,
  downloadAsync,
  getInfoAsync,
  makeDirectoryAsync,
} from 'expo-file-system/legacy';
import { DeviceEventEmitter, Platform } from 'react-native';
import type { Database } from '@/types/database';
import type { Child as LocalChild } from '@/types/local';
import { getCachedUserMode } from '@/lib/userMode';
import {
  deleteLocalBook,
  deleteLocalChild,
  deleteLocalMemory,
  getAllLocalMemories,
  getLocalChild,
  listLocalBooks,
  listLocalChildren,
  reassignLocalMemoriesChildId,
  upsertLocalChild,
} from '@/lib/localDb';
import { deleteLocalMediaFiles } from '@/lib/localCleanup';
import { invalidateMemoryLimitCache } from '@/lib/limits';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import { getSignedMediaDisplayUrl } from '@/lib/mediaSignedUrl';
import { resolveChildProfileImageUri } from '@/utils/childPhotoUri';
import { ensureLocalImageForPalette } from '@/hooks/ensureLocalImageForPalette';
import { normalizeChildGivenName } from '@/utils/childDisplayName'
import { isLegacyHeroHeuristicOnProfileCrop, isValidFaceBounds } from '@/utils/avatarFaceBounds';
import { detectFaceBounds, estimatePortraitFaceBounds } from '@/utils/detectFace';

type ChildRow = Database['public']['Tables']['children']['Row'];

/**
 * ChildRow étendu avec les colonnes face bounds — présentes en BDD après la migration
 * 20260527000000_add_face_bounds_to_children.sql mais pas encore dans les types générés.
 * À supprimer une fois `supabase gen types` relancé.
 */
type ChildRowWithFace = ChildRow & {
  face_cx?: number | null
  face_cy?: number | null
  face_h?: number | null
  face_img_aspect?: number | null
}

/** Émis après mise à jour profil enfant (photo, nom…) — ex. rafraîchir l’onglet Capturer. */
export const PETITMO_CHILD_PROFILE_UPDATED_EVENT = 'petitmo:child-profile-updated' as const;

export type ChildProfileUpdatedPayload = {
  childId: string;
  /** Profil déjà persisté (SQLite) — évite un `getChildren` potentiellement en retard. */
  child?: LocalChild;
};

export function notifyChildProfileUpdated(childId: string, child?: LocalChild): void {
  const id = childId.trim();
  if (!id) return;
  const payload: ChildProfileUpdatedPayload = { childId: id };
  if (child && child.id === id) {
    payload.child = child;
  }
  DeviceEventEmitter.emit(PETITMO_CHILD_PROFILE_UPDATED_EVENT, payload);
}

function isChildDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  if (code === '23505') return true;
  const msg = String((error as { message?: string }).message ?? '');
  return /duplicate key|unique constraint/i.test(msg);
}

function withLocalChildFields(row: ChildRow): LocalChild {
  const r = row as ChildRowWithFace
  return {
    ...row,
    local_photo_path: null,
    face_cx: typeof r.face_cx === 'number' && Number.isFinite(r.face_cx) ? r.face_cx : null,
    face_cy: typeof r.face_cy === 'number' && Number.isFinite(r.face_cy) ? r.face_cy : null,
    face_h: typeof r.face_h === 'number' && Number.isFinite(r.face_h) ? r.face_h : null,
    face_img_aspect:
      typeof r.face_img_aspect === 'number' && Number.isFinite(r.face_img_aspect)
        ? r.face_img_aspect
        : null,
  }
}

/** Extrait les bounds visage d'un objet quelconque (Supabase row, LocalChild…). */
/** Photo présente mais bounds visage absents ou invalides. */
export function childNeedsFaceBoundsBackfill(child: LocalChild): boolean {
  const hasPhoto =
    !!(child.local_photo_path ?? '').trim() || !!(child.photo_url ?? '').trim();
  if (!hasPhoto) return false;
  if (!isValidFaceBounds(child)) return true;
  return isLegacyHeroHeuristicOnProfileCrop(child);
}

/**
 * Garantit des bounds visage en SQLite (ML, heuristique fichier, ou repli portrait).
 * À appeler après lecture profil / avant affichage fil.
 */
/** Profil enfant à jour depuis SQLite (fil / focus onglet). */
export async function refreshChildProfileFromLocal(childId: string): Promise<LocalChild | null> {
  const id = childId.trim();
  if (!id) return null;
  const row = getLocalChild(id);
  if (!row) return null;
  return sanitizeChildLocalAvatarIfMissing(row);
}

export async function ensureChildFaceBounds(
  child: LocalChild,
  opts?: { notify?: boolean },
): Promise<LocalChild> {
  const shouldNotify = opts?.notify !== false;
  const row = getLocalChild(child.id) ?? child;
  let current = await sanitizeChildLocalAvatarIfMissing(row);
  if (!childNeedsFaceBoundsBackfill(current)) return current;

  const lp = (current.local_photo_path ?? '').trim();
  const remote = (current.photo_url ?? '').trim();

  if (lp) {
    const uri = resolveChildProfileImageUri(lp, null);
    if (uri?.startsWith('file')) {
      try {
        const info = await getInfoAsync(uri);
        if (info.exists && !info.isDirectory) {
          const bounds =
            (await detectFaceBounds(uri)) ?? (await estimatePortraitFaceBounds(uri));
          const next: LocalChild = {
            ...current,
            ...bounds,
          };
          upsertLocalChild(next);
          if (shouldNotify) notifyChildProfileUpdated(current.id, next);
          return next;
        }
      } catch {
        /* fichier illisible → repli ci-dessous */
      }
    }
  }

  if (remote && !lp) {
    return cacheRemoteChildProfilePhotoLocally(current);
  }

  const uri = lp ? resolveChildProfileImageUri(lp, null) : null;
  const bounds = uri
    ? await estimatePortraitFaceBounds(uri).catch(() => estimatePortraitFaceBounds(''))
    : await estimatePortraitFaceBounds('');

  const next: LocalChild = {
    ...current,
    ...bounds,
  };
  upsertLocalChild(next);
  if (shouldNotify) notifyChildProfileUpdated(current.id, next);
  return next;
}

function scheduleChildFaceBoundsBackfill(children: LocalChild[]): void {
  void (async () => {
    for (const c of children) {
      if (!childNeedsFaceBoundsBackfill(c)) continue;
      try {
        await ensureChildFaceBounds(c, { notify: false });
      } catch {
        /* ignore */
      }
    }
  })();
}

function pickFaceBounds(src: {
  face_cx?: number | null
  face_cy?: number | null
  face_h?: number | null
  face_img_aspect?: number | null
} | null | undefined) {
  if (!src) return { face_cx: null, face_cy: null, face_h: null, face_img_aspect: null }
  const n = (v: unknown) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  return {
    face_cx: n(src.face_cx),
    face_cy: n(src.face_cy),
    face_h: n(src.face_h),
    face_img_aspect: n(src.face_img_aspect),
  }
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

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const info = await getInfoAsync(uri);
      if (info.exists && !info.isDirectory) {
        return child;
      }
    } catch {
      /* fichier inaccessible */
    }
    if (attempt === 0) {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 180);
      });
    }
  }

  /** Pas de `photo_url` : chemin local mort (réinstall) → placeholder plutôt qu’URI illisible. */
  if (!(child.photo_url ?? '').trim()) {
    console.warn('[children] avatar local introuvable, nettoyage local_photo_path', child.id);
    const next: LocalChild = { ...child, local_photo_path: null };
    upsertLocalChild(next);
    return next;
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
  return ensureChildFaceBounds(row);
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

    // Détecter le visage sur l'image fraîchement téléchargée si les bounds sont absentes.
    // Couvre la reconnexion sur nouveau téléphone avant que cette feature n'existe
    // (bounds nulles en Supabase) — on les calcule une fois puis on les persiste dans les 2 sens.
    const hasBounds = isValidFaceBounds(row);
    const detectedFace = hasBounds ? null : await detectFaceBounds(res.uri).catch(() => null);
    const faceToSave = hasBounds
      ? pickFaceBounds(row)
      : detectedFace ?? (await estimatePortraitFaceBounds(res.uri));

    const next: LocalChild = {
      ...row,
      local_photo_path: res.uri,
      updated_at: new Date().toISOString(),
      ...faceToSave,
    };
    upsertLocalChild(next);

    // Si on vient de détecter des bounds manquantes → les pousser vers Supabase silencieusement.
    if (!hasBounds && detectedFace) {
      supabase
        .from('children')
        .update(faceToSave as Record<string, unknown>)
        .eq('id', row.id)
        .then(({ error }) => {
          if (error) console.warn('[children] face bounds sync to Supabase', row.id, error.message)
        })
    }

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
      const list = listLocalChildren();
      scheduleChildFaceBoundsBackfill(list);
      return list;
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

      // Bounds visage : priorité local (plus récent), repli sur Supabase (nouveau téléphone).
      const remoteFace = pickFaceBounds(base)
      const localFace = pickFaceBounds(local)
      const face = {
        face_cx: localFace.face_cx ?? remoteFace.face_cx,
        face_cy: localFace.face_cy ?? remoteFace.face_cy,
        face_h: localFace.face_h ?? remoteFace.face_h,
        face_img_aspect: localFace.face_img_aspect ?? remoteFace.face_img_aspect,
      }

      const merged: LocalChild = { ...base, local_photo_path: lp || null, ...face }

      // Persister en SQLite pour que les lectures locales-first soient à jour.
      upsertLocalChild(merged)

      return merged
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
      const detected = await detectFaceBounds(dest).catch(() => null);
      const faceMeta = detected ?? (await estimatePortraitFaceBounds(dest));
      const now = new Date().toISOString();
      const next: LocalChild = {
        ...cur,
        local_photo_path: dest,
        photo_url: null,
        updated_at: now,
        ...faceMeta,
      };
      upsertLocalChild(next);
      notifyChildProfileUpdated(childId, next);
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
    // Détection visage sur le fichier local (sandbox ou source originale)
    const faceSource = sandboxPath || (photoUri.startsWith('file') ? photoUri : null);
    const detectedFace = faceSource
      ? await detectFaceBounds(faceSource).catch(() => null)
      : null;
    const faceMeta = pickFaceBounds(detectedFace);

    const existing = getLocalChild(childId);
    const now = new Date().toISOString();
    if (sandboxPath) {
      if (existing) {
        upsertLocalChild({
          ...existing,
          photo_url: signedUrl,
          local_photo_path: sandboxPath,
          updated_at: now,
          ...faceMeta,
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
            ...faceMeta,
          });
        }
      }
    } else if (existing) {
      upsertLocalChild({
        ...existing,
        photo_url: signedUrl,
        updated_at: now,
        ...faceMeta,
      });
    }

    const { error: faceSyncErr } = await supabase
      .from('children')
      .update(faceMeta as Record<string, unknown>)
      .eq('id', childId);
    if (faceSyncErr) {
      console.warn('[children] face bounds sync after photo upload', childId, faceSyncErr.message);
    }

    const refreshed = getLocalChild(childId);
    notifyChildProfileUpdated(childId, refreshed ?? undefined);
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

export async function createChild(rawName: string, birthdate?: string, photoUri?: string) {
  const name = normalizeChildGivenName(rawName);
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
      const faceMeta = localPhotoPath
        ? (await detectFaceBounds(localPhotoPath).catch(() => null)) ??
          (await estimatePortraitFaceBounds(localPhotoPath))
        : pickFaceBounds(null);
      const row: LocalChild = {
        id,
        user_id: user.id,
        name,
        birthdate: birthdateValue,
        photo_url: null,
        created_at: now,
        updated_at: now,
        local_photo_path: localPhotoPath,
        ...faceMeta,
      };
      upsertLocalChild(row);
      notifyChildProfileUpdated(id, row);
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

const CHILD_ORIGINAL_PHOTO_KEY_PREFIX = '@petitmo_child_original_photo_v1:';

export type DeleteChildResult = {
  deletedChildId: string;
  wasLastChild: boolean;
  memoriesPurged: boolean;
  reassignedToChildId?: string;
};

function pickReassignTargetChildId(remaining: LocalChild[]): string | null {
  const sorted = sortChildrenByBirthdateAsc(remaining);
  return sorted[0]?.id ?? null;
}

async function deleteChildAvatarFiles(child: LocalChild): Promise<void> {
  if (Platform.OS !== 'web') {
    const lp = (child.local_photo_path ?? '').trim();
    if (lp) {
      try {
        await deleteAsync(lp, { idempotent: true });
      } catch {
        /* fichier déjà absent */
      }
    }
    if (documentDirectory) {
      const root = `${documentDirectory}petitmo_children/`;
      for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']) {
        try {
          await deleteAsync(`${root}${child.id}.${ext}`, { idempotent: true });
        } catch {
          /* */
        }
      }
    }
  }
  try {
    await AsyncStorage.removeItem(`${CHILD_ORIGINAL_PHOTO_KEY_PREFIX}${child.id}`);
  } catch {
    /* */
  }
}

async function purgeAllLocalMemoriesAndBooks(): Promise<void> {
  const memories = getAllLocalMemories();
  for (const memory of memories) {
    await deleteLocalMediaFiles(memory);
    deleteLocalMemory(memory.id);
  }
  for (const book of listLocalBooks()) {
    deleteLocalBook(book.id);
  }
}

/**
 * Supprime un profil enfant.
 * — Plusieurs enfants : profil retiré, souvenirs conservés (réassignés pour la FK technique).
 * — Dernier enfant : profil + tous les souvenirs (+ livres locaux) supprimés.
 */
export async function deleteChild(childId: string): Promise<DeleteChildResult> {
  const id = childId.trim();
  if (!id) throw new Error('Identifiant enfant invalide');

  const child = getLocalChild(id);
  if (!child) throw new Error('Profil introuvable');

  const allChildren = listLocalChildren();
  const remaining = allChildren.filter(c => c.id !== id);
  const wasLastChild = remaining.length === 0;
  const reassignTargetId = wasLastChild ? null : pickReassignTargetChildId(remaining);

  if (!wasLastChild && !reassignTargetId) {
    throw new Error('Impossible de réassigner les souvenirs');
  }

  if (wasLastChild) {
    await purgeAllLocalMemoriesAndBooks();
  } else {
    reassignLocalMemoriesChildId(id, reassignTargetId!);
  }

  const isCloud = (await getCachedUserMode()) === 'cloud';
  if (isCloud) {
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) throw new Error('User not authenticated');

    if (!wasLastChild) {
      const { error: reassignErr } = await supabase
        .from('memories')
        .update({ child_id: reassignTargetId! })
        .eq('child_id', id);
      if (reassignErr) throw reassignErr;
    }

    const { error: delChildErr } = await supabase.from('children').delete().eq('id', id);
    if (delChildErr) throw delChildErr;
  }

  await deleteChildAvatarFiles(child);
  deleteLocalChild(id);

  const selected = await getSelectedChild();
  if (selected === id) {
    if (wasLastChild) {
      selectedChildIdLastKnown = null;
      setCaptureTabChildSnapshot(null);
      try {
        await AsyncStorage.removeItem(SELECTED_CHILD_KEY);
      } catch {
        /* */
      }
    } else if (reassignTargetId) {
      await setSelectedChild(reassignTargetId);
    }
  }

  invalidateMemoryLimitCache();
  DeviceEventEmitter.emit('petitmo:memories-invalidate');
  for (const c of remaining) {
    notifyChildProfileUpdated(c.id, c);
  }

  return {
    deletedChildId: id,
    wasLastChild,
    memoriesPurged: wasLastChild,
    reassignedToChildId: reassignTargetId ?? undefined,
  };
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
    const patch = {
      ...updates,
      ...(updates.name !== undefined ? { name: normalizeChildGivenName(updates.name) } : {}),
    };

    // Si un nouveau chemin local est fourni, on tente une détection de visage en arrière-plan.
    // Les résultats seront intégrés dans `next` avant upsert.
    const newLocalPath = updates.local_photo_path ?? null;
    const faceBounds =
      newLocalPath ? await detectFaceBounds(newLocalPath).catch(() => null) : undefined;

    if ((await getCachedUserMode()) === 'local') {
      const cur = getLocalChild(childId);
      if (!cur) throw new Error('Child not found locally');
      const next: LocalChild = {
        ...cur,
        ...patch,
        birthdate:
          updates.birthdate !== undefined ? updates.birthdate ?? '' : cur.birthdate,
        updated_at: new Date().toISOString(),
        // Si on a un nouveau chemin, on écrase les bounds ; sinon on conserve les anciennes
        ...(newLocalPath !== undefined
          ? {
              face_cx: faceBounds?.face_cx ?? null,
              face_cy: faceBounds?.face_cy ?? null,
              face_h: faceBounds?.face_h ?? null,
              face_img_aspect: faceBounds?.face_img_aspect ?? null,
            }
          : {}),
      };
      upsertLocalChild(next);
      notifyChildProfileUpdated(childId, next);
      return next;
    }

    // Inclure les face bounds dans la mise à jour Supabase si on en a calculé de nouvelles.
    const cloudPatch: Record<string, unknown> = { ...patch }
    if (newLocalPath !== undefined) {
      cloudPatch.face_cx = faceBounds?.face_cx ?? null
      cloudPatch.face_cy = faceBounds?.face_cy ?? null
      cloudPatch.face_h = faceBounds?.face_h ?? null
      cloudPatch.face_img_aspect = faceBounds?.face_img_aspect ?? null
    }

    const { data, error } = await supabase
      .from('children')
      .update(cloudPatch)
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
      // Face bounds : nouvelles si on a changé la photo, sinon on conserve les locales
      ...(newLocalPath !== undefined
        ? {
            face_cx: faceBounds?.face_cx ?? null,
            face_cy: faceBounds?.face_cy ?? null,
            face_h: faceBounds?.face_h ?? null,
            face_img_aspect: faceBounds?.face_img_aspect ?? null,
          }
        : {
            face_cx: local?.face_cx ?? null,
            face_cy: local?.face_cy ?? null,
            face_h: local?.face_h ?? null,
            face_img_aspect: local?.face_img_aspect ?? null,
          }),
    };
    upsertLocalChild(next);
    notifyChildProfileUpdated(childId, next);
    return next;
  } catch (error) {
    console.error('Update child error:', error);
    throw error;
  }
}
