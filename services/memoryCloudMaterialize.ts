import { DeviceEventEmitter, Image, Platform } from 'react-native';
import { documentDirectory, downloadAsync, makeDirectoryAsync } from 'expo-file-system/legacy';
import { getCachedUserMode } from '@/lib/userMode';
import { getLocalMemoryById, upsertLocalMemory } from '@/lib/localDb';
import type { Memory } from '@/types/local';
import {
  awaitVideoPosterForBookMemory,
  ensureLocalPhotoDerivatives,
  persistOriginalToSandbox,
} from '@/services/memoryLocalStore';
import { healDeadLocalMediaPointersForMemory } from '@/services/memoryDisplayHeal';
import {
  extractMediaBucketPath,
  getSignedMediaDisplayUrl,
} from '@/lib/mediaSignedUrl';
import {
  collectPhotoLocalUploadUriCandidates,
  collectVideoPosterLocalUploadUriCandidates,
  collectVideoFeedPosterLocalUriCandidates,
  collectVideoCloudSyncUriCandidates,
  collectVoiceCoverLocalUploadUriCandidates,
  getVideoPosterPrintUriForBookPreview,
  isDeviceLocalMediaUri,
} from '@/utils/memoryPhotos';
import {
  isCloudMediaReference,
  isLocalMediaUriReadable,
  pickFirstReadableLocalMediaUri,
} from '@/utils/localMediaReadable';

const materializeInFlight = new Set<string>();

function memorySandboxDir(memoryId: string): string | null {
  if (Platform.OS === 'web' || !documentDirectory) return null;
  const id = memoryId.trim();
  if (!id) return null;
  return `${documentDirectory}petitmo_memories/${id}/`;
}

/**
 * Les colonnes `*_url` stockent des URLs **signées 7 jours** (`getSignedUrlAfterMediaUpload`).
 * Passé ce délai elles renvoient 400 : toujours re-signer depuis le chemin bucket,
 * sinon toute materialisation d’un souvenir de plus d’une semaine échoue en silence.
 */
async function resolveCloudRefToHttps(raw: string): Promise<string | null> {
  const t = raw.trim();
  if (!t) return null;
  const bucketPath = extractMediaBucketPath(t);
  if (bucketPath) {
    const signed = (await getSignedMediaDisplayUrl(bucketPath)).trim();
    if (signed && /^https?:\/\//i.test(signed)) return signed;
  }
  if (/^https?:\/\//i.test(t)) return t;
  return null;
}

/** Télécharge un fichier cloud (URL ou bucket path) vers le sandbox du souvenir. */
export async function downloadCloudFileToSandbox(
  memoryId: string,
  remoteRef: string,
  destFilename: string,
): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  const dir = memorySandboxDir(memoryId);
  if (!dir) return null;

  const httpsUrl = await resolveCloudRefToHttps(remoteRef);
  if (!httpsUrl) return null;

  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}${destFilename}`;
  const tmp = `${dir}cloud_fetch_${Date.now()}_${destFilename}`;

  try {
    const dl = await downloadAsync(httpsUrl, tmp);
    if (dl.status !== 200) return null;
    const { copyAsync } = await import('expo-file-system/legacy');
    await copyAsync({ from: dl.uri, to: dest });
    return dest;
  } catch {
    return null;
  }
}

/** Télécharge l’original cloud dans le sandbox quand les pointeurs locaux sont morts (sync / autre appareil). */
export async function downloadCloudOriginalToSandbox(
  row: Memory,
  type: 'photo' | 'video' | 'voice',
): Promise<string | null> {
  if (Platform.OS === 'web' || !documentDirectory) return null;

  let httpsUrl: string | null = null;
  const mediaPath = (row.media_path ?? '').trim();
  if (mediaPath) {
    httpsUrl = await getSignedMediaDisplayUrl(mediaPath);
  } else {
    for (const u of [row.media_url, row.edited_media_url]) {
      const t = (u ?? '').trim();
      if (!t) continue;
      // Re-signer d’abord : l’URL en base expire au bout de 7 jours.
      const resolved = await resolveCloudRefToHttps(t);
      if (resolved) {
        httpsUrl = resolved;
        break;
      }
    }
  }
  if (!httpsUrl) return null;

  const id = row.id.trim();
  const dir = `${documentDirectory}petitmo_memories/${id}/`;
  await makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const ext =
    type === 'video'
      ? (mediaPath.split('.').pop()?.toLowerCase() || 'mp4')
      : type === 'voice'
        ? (mediaPath.split('.').pop()?.toLowerCase() || 'm4a')
        : (mediaPath.split('.').pop()?.toLowerCase() || 'jpg');
  const tmp = `${dir}cloud_fetch_${Date.now()}.${ext}`;

  try {
    const dl = await downloadAsync(httpsUrl, tmp);
    if (dl.status !== 200) return null;
    const { localOriginalUri } = await persistOriginalToSandbox({
      memoryId: id,
      type,
      sourceUri: dl.uri,
    });
    const local = localOriginalUri ?? dl.uri;
    upsertLocalMemory({
      ...getLocalMemoryById(id) ?? row,
      local_original_path: local,
      local_media_path: local,
      updated_at: new Date().toISOString(),
    });
    return local;
  } catch {
    return null;
  }
}

function remoteVideoPosterRef(memory: Memory): string {
  for (const u of [memory.poster_url, memory.thumbnail_url]) {
    const t = (u ?? '').trim();
    if (t && !isDeviceLocalMediaUri(t)) return t;
  }
  return '';
}

function hasCloudOriginalRef(memory: Memory): boolean {
  if ((memory.media_path ?? '').trim()) return true;
  for (const u of [memory.media_url, memory.edited_media_url]) {
    const t = (u ?? '').trim();
    if (t && isCloudMediaReference(t)) return true;
  }
  return false;
}

async function hasReadablePhotoForFeed(memory: Memory): Promise<boolean> {
  return !!(await pickFirstReadableLocalMediaUri([
    memory.local_thumb_path,
    memory.local_display_path,
    memory.local_print_path,
    ...collectPhotoLocalUploadUriCandidates(memory),
  ]));
}

async function hasReadableVideoFeedPoster(memory: Memory): Promise<boolean> {
  return !!(await pickFirstReadableLocalMediaUri(collectVideoFeedPosterLocalUriCandidates(memory)));
}

async function hasReadableVideoPrintPoster(memory: Memory): Promise<boolean> {
  const printUri = getVideoPosterPrintUriForBookPreview(memory).trim();
  if (!printUri || !isDeviceLocalMediaUri(printUri)) return false;
  return isLocalMediaUriReadable(printUri);
}

function remoteVideoPosterPrintRef(memory: Memory): string {
  const t = (memory.poster_print_url ?? '').trim();
  if (t && !isDeviceLocalMediaUri(t)) return t;
  return '';
}

async function hasReadableVideoOriginal(memory: Memory): Promise<boolean> {
  const localOnly = collectVideoCloudSyncUriCandidates(memory).filter(
    u => !/^https?:\/\//i.test(u.trim()) && !u.endsWith('poster.jpg'),
  );
  return !!(await pickFirstReadableLocalMediaUri(localOnly));
}

async function hasReadableVoiceAudio(memory: Memory): Promise<boolean> {
  return !!(await pickFirstReadableLocalMediaUri([
    memory.local_original_path,
    memory.local_media_path,
  ]));
}

async function hasReadableVoiceCover(memory: Memory): Promise<boolean> {
  return !!(await pickFirstReadableLocalMediaUri(collectVoiceCoverLocalUploadUriCandidates(memory)));
}

async function hasReadablePhotoPrint(memory: Memory): Promise<boolean> {
  const printPath = (memory.local_print_path ?? '').trim();
  if (!printPath) return false;
  return isLocalMediaUriReadable(printPath);
}

/** Ref cloud du JPEG print livre (jamais un chemin sandbox). */
function remotePhotoPrintRef(memory: Memory): string | null {
  const t = (memory.print_url ?? '').trim();
  if (!t || isDeviceLocalMediaUri(t)) return null;
  if (/^https?:\/\//i.test(t) || isCloudMediaReference(t) || !!extractMediaBucketPath(t)) {
    return t;
  }
  return null;
}

async function measureSandboxImagePx(uri: string): Promise<{ w: number; h: number } | null> {
  // Import statique obligatoire : `await import('react-native')` force Metro importAll
  // (PushNotificationIOS → NativeEventEmitter(null) → crash fatal New Arch).
  try {
    return await new Promise(resolve => {
      Image.getSize(
        uri,
        (w, h) => resolve(w > 0 && h > 0 ? { w, h } : null),
        () => resolve(null),
      );
    });
  } catch {
    return null;
  }
}

/** True si le souvenir a des refs cloud mais pas encore de fichiers sandbox lisibles pour l’affichage. */
export async function memoryNeedsCloudMaterialization(memory: Memory): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if ((await getCachedUserMode()) === 'local') return false;
  if (memory.type === 'text') return false;

  if (memory.type === 'photo') {
    const feedOk = await hasReadablePhotoForFeed(memory);
    const printOk = await hasReadablePhotoPrint(memory);
    const needsCloudPrint = !printOk && !!remotePhotoPrintRef(memory);
    // Feed OK mais print manquant (réinstall) → encore besoin de matérialiser le print livre.
    if (feedOk && !needsCloudPrint) return false;
    if (needsCloudPrint) return true;
    return (
      hasCloudOriginalRef(memory) ||
      isCloudMediaReference((memory.thumb_url ?? '').trim()) ||
      isCloudMediaReference((memory.display_url ?? '').trim())
    );
  }

  if (memory.type === 'video') {
    const needsPoster = !(await hasReadableVideoFeedPoster(memory));
    const needsVideo = !(await hasReadableVideoOriginal(memory));
    if (!needsPoster && !needsVideo) return false;
    return (
      hasCloudOriginalRef(memory) ||
      !!remoteVideoPosterRef(memory) ||
      isCloudMediaReference((memory.thumbnail_url ?? '').trim())
    );
  }

  if (memory.type === 'voice') {
    const needsAudio = !(await hasReadableVoiceAudio(memory));
    const needsCover =
      !!(memory.voice_cover_url ?? '').trim() &&
      !isDeviceLocalMediaUri(memory.voice_cover_url) &&
      !(await hasReadableVoiceCover(memory));
    if (!needsAudio && !needsCover) return false;
    return needsAudio ? hasCloudOriginalRef(memory) : true;
  }

  return false;
}

async function materializePhotoMemory(row: Memory): Promise<boolean> {
  let memory = getLocalMemoryById(row.id) ?? row;
  let changed = false;

  // 1) Thumb / display fil (local-first UX).
  if (!(await hasReadablePhotoForFeed(memory))) {
    const thumbPath = (memory.local_thumb_path ?? '').trim();
    if (!thumbPath || !(await isLocalMediaUriReadable(thumbPath))) {
      const remote = (memory.thumb_url ?? '').trim();
      if (remote && !isDeviceLocalMediaUri(remote)) {
        const local = await downloadCloudFileToSandbox(memory.id, remote, 'thumb.jpg');
        if (local) {
          memory = {
            ...memory,
            local_thumb_path: local,
            updated_at: new Date().toISOString(),
          };
          upsertLocalMemory(memory);
          changed = true;
        }
      }
    }

    memory = getLocalMemoryById(row.id) ?? memory;

    const displayPath = (memory.local_display_path ?? '').trim();
    if (!displayPath || !(await isLocalMediaUriReadable(displayPath))) {
      const remote = (memory.display_url ?? '').trim();
      if (remote && !isDeviceLocalMediaUri(remote)) {
        const local = await downloadCloudFileToSandbox(memory.id, remote, 'display.jpg');
        if (local) {
          memory = {
            ...memory,
            local_display_path: local,
            updated_at: new Date().toISOString(),
          };
          upsertLocalMemory(memory);
          changed = true;
        }
      }
    }

    memory = getLocalMemoryById(row.id) ?? memory;

    // Original cloud (Petitmo+ / si présent) → régénère aussi print local.
    if (!(await hasReadablePhotoForFeed(memory))) {
      const localOriginal = await downloadCloudOriginalToSandbox(memory, 'photo');
      if (localOriginal) {
        const d = await ensureLocalPhotoDerivatives({
          memoryId: memory.id,
          localOriginalUri: localOriginal,
        });
        upsertLocalMemory({
          ...(getLocalMemoryById(row.id) ?? memory),
          local_original_path: localOriginal,
          local_media_path: localOriginal,
          local_thumb_path: d.localThumbUri ?? memory.local_thumb_path,
          local_display_path: d.localDisplayUri ?? memory.local_display_path,
          local_print_path: d.localPrintUri ?? memory.local_print_path,
          original_px_w: d.originalPx?.w ?? memory.original_px_w,
          original_px_h: d.originalPx?.h ?? memory.original_px_h,
          print_px_w: d.printPx?.w ?? memory.print_px_w,
          print_px_h: d.printPx?.h ?? memory.print_px_h,
          updated_at: new Date().toISOString(),
        });
        changed = true;
        memory = getLocalMemoryById(row.id) ?? memory;
      }
    }
  } else {
    // Feed OK : si original local lisible, (re)génère print manquant sans cloud.
    const printPath = (memory.local_print_path ?? '').trim();
    const hasPrint = printPath ? await isLocalMediaUriReadable(printPath) : false;
    if (!hasPrint) {
      const orig = await pickFirstReadableLocalMediaUri(collectPhotoLocalUploadUriCandidates(memory));
      if (orig) {
        const d = await ensureLocalPhotoDerivatives({ memoryId: memory.id, localOriginalUri: orig });
        if (d.localPrintUri || d.localDisplayUri || d.localThumbUri) {
          upsertLocalMemory({
            ...memory,
            local_thumb_path: d.localThumbUri ?? memory.local_thumb_path,
            local_display_path: d.localDisplayUri ?? memory.local_display_path,
            local_print_path: d.localPrintUri ?? memory.local_print_path,
            original_px_w: d.originalPx?.w ?? memory.original_px_w,
            original_px_h: d.originalPx?.h ?? memory.original_px_h,
            print_px_w: d.printPx?.w ?? memory.print_px_w,
            print_px_h: d.printPx?.h ?? memory.print_px_h,
            updated_at: new Date().toISOString(),
          });
          changed = true;
          memory = getLocalMemoryById(row.id) ?? memory;
        }
      }
    }
  }

  // 2) Print livre : télécharger `print_url` cloud → sandbox (réinstall / autre téléphone).
  memory = getLocalMemoryById(row.id) ?? memory;
  if (!(await hasReadablePhotoPrint(memory))) {
    const remotePrint = remotePhotoPrintRef(memory);
    if (remotePrint) {
      const localPrint = await downloadCloudFileToSandbox(memory.id, remotePrint, 'print.jpg');
      if (localPrint) {
        const printPx = await measureSandboxImagePx(localPrint);
        upsertLocalMemory({
          ...(getLocalMemoryById(row.id) ?? memory),
          local_print_path: localPrint,
          print_px_w: printPx?.w ?? memory.print_px_w,
          print_px_h: printPx?.h ?? memory.print_px_h,
          updated_at: new Date().toISOString(),
        });
        changed = true;
      }
    }
  }

  return changed;
}

async function materializeVideoMemory(row: Memory): Promise<boolean> {
  let memory = getLocalMemoryById(row.id) ?? row;
  let changed = false;

  if (!(await hasReadableVideoOriginal(memory)) && hasCloudOriginalRef(memory)) {
    const localVideo = await downloadCloudOriginalToSandbox(memory, 'video');
    if (localVideo) {
      changed = true;
      memory = getLocalMemoryById(row.id) ?? memory;
    }
  }

  memory = getLocalMemoryById(row.id) ?? memory;

  if (!(await hasReadableVideoFeedPoster(memory))) {
    const remotePoster = remoteVideoPosterRef(memory);
    if (remotePoster) {
      const localPoster = await downloadCloudFileToSandbox(memory.id, remotePoster, 'poster.jpg');
      if (localPoster) {
        upsertLocalMemory({
          ...memory,
          local_thumb_path: localPoster,
          poster_url: localPoster,
          thumbnail_url: localPoster,
          updated_at: new Date().toISOString(),
        });
        changed = true;
        memory = getLocalMemoryById(row.id) ?? memory;
      }
    }
  }

  if (!(await hasReadableVideoFeedPoster(memory))) {
    const updated = await awaitVideoPosterForBookMemory(memory.id);
    if (updated) changed = true;
    memory = getLocalMemoryById(row.id) ?? memory;
  }

  if (!(await hasReadableVideoPrintPoster(memory))) {
    const remotePrint = remoteVideoPosterPrintRef(memory);
    if (remotePrint) {
      const localPrint = await downloadCloudFileToSandbox(memory.id, remotePrint, 'poster_print.jpg');
      if (localPrint) {
        upsertLocalMemory({
          ...(getLocalMemoryById(row.id) ?? memory),
          local_poster_print_path: localPrint,
          poster_print_url: localPrint,
          updated_at: new Date().toISOString(),
        });
        changed = true;
      }
    }
  }

  return changed;
}

async function materializeVoiceMemory(row: Memory): Promise<boolean> {
  let memory = getLocalMemoryById(row.id) ?? row;
  let changed = false;

  if (!(await hasReadableVoiceAudio(memory)) && hasCloudOriginalRef(memory)) {
    const local = await downloadCloudOriginalToSandbox(memory, 'voice');
    if (local) {
      changed = true;
      memory = getLocalMemoryById(row.id) ?? memory;
    }
  }

  memory = getLocalMemoryById(row.id) ?? memory;

  const coverRemote = (memory.voice_cover_url ?? '').trim();
  if (coverRemote && !isDeviceLocalMediaUri(coverRemote) && !(await hasReadableVoiceCover(memory))) {
    const localCover = await downloadCloudFileToSandbox(memory.id, coverRemote, 'voice_cover.jpg');
    if (localCover) {
      upsertLocalMemory({
        ...memory,
        voice_cover_path: localCover,
        updated_at: new Date().toISOString(),
      });
      changed = true;
    }
  }

  return changed;
}

/**
 * Copie cloud → sandbox pour un souvenir : original + dérivés (thumb, poster…).
 * Invariant local-first Petitmo+ : après materialisation, l’UI ne dépend plus du cloud.
 */
export async function materializeCloudMediaToSandboxForMemory(
  memoryOrId: Memory | string,
): Promise<Memory | null> {
  if (Platform.OS === 'web') return null;
  if ((await getCachedUserMode()) === 'local') return null;

  const id = (typeof memoryOrId === 'string' ? memoryOrId : memoryOrId.id).trim();
  if (!id) return null;
  if (materializeInFlight.has(id)) return getLocalMemoryById(id);

  materializeInFlight.add(id);
  try {
    let memory = getLocalMemoryById(id);
    if (!memory) return null;
    if (memory.type === 'text') return memory;

    if (!(await memoryNeedsCloudMaterialization(memory))) return memory;

    memory = await healDeadLocalMediaPointersForMemory(memory);
    memory = getLocalMemoryById(id) ?? memory;

    if (!(await memoryNeedsCloudMaterialization(memory))) return memory;

    let changed = false;
    if (memory.type === 'photo') {
      changed = await materializePhotoMemory(memory);
    } else if (memory.type === 'video') {
      changed = await materializeVideoMemory(memory);
    } else if (memory.type === 'voice') {
      changed = await materializeVoiceMemory(memory);
    }

    const result = getLocalMemoryById(id) ?? memory;
    if (changed) {
      DeviceEventEmitter.emit('petitmo:memories-updated', { memoryId: id });
    }
    return result;
  } catch (e) {
    console.warn('[memoryCloudMaterialize] failed', id, e);
    return getLocalMemoryById(id);
  } finally {
    materializeInFlight.delete(id);
  }
}

/** Materialise en arrière-plan les souvenirs visibles (fil, pull cloud, restauration). */
export async function materializeCloudMediaForMemories(
  memories: readonly Memory[],
  options?: { max?: number; batchSize?: number },
): Promise<void> {
  if (Platform.OS === 'web') return;
  if ((await getCachedUserMode()) === 'local') return;

  const max = options?.max ?? 24;
  const batchSize = options?.batchSize ?? 4;
  const candidates: Memory[] = [];

  for (const m of memories) {
    if (candidates.length >= max) break;
    if (m.type === 'text') continue;
    if (await memoryNeedsCloudMaterialization(m)) candidates.push(m);
  }

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    await Promise.all(batch.map(m => materializeCloudMediaToSandboxForMemory(m.id)));
  }
}
