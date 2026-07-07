/**
 * Cache module-level de la dernière URI de lecture `file://` résolue par vidéo (indexée `memory.id`).
 *
 * BUG 1 (voir docs/bug-feed-video-flash.md) : pour une ancienne vidéo matérialisée (sans bootstrap ni
 * copie-fil synchrone), `syncFeedLocalVideoPlaybackUri` renvoie `''` au montage ; l'URI `file://` réelle
 * n'arrive qu'après résolution async. À chaque remontage de la cellule (recyclage FlatList au scroll),
 * cette fenêtre « URI vide » fait rendre l'état poster+play plein écran → flash.
 *
 * En mémorisant la dernière URI locale résolue, on peut **seeder l'état initial** du hook au remontage :
 * plus de fenêtre vide, donc plus de flash poster+play.
 */
const feedVideoPlaybackUriById = new Map<string, string>();

export function getCachedFeedVideoPlaybackUri(memoryId: string): string {
  const id = memoryId?.trim();
  if (!id) return '';
  return feedVideoPlaybackUriById.get(id) ?? '';
}

export function setCachedFeedVideoPlaybackUri(memoryId: string, uri: string): void {
  const id = memoryId?.trim();
  if (!id) return;
  const value = (uri ?? '').trim();
  if (!value) return;
  if (feedVideoPlaybackUriById.get(id) === value) return;
  feedVideoPlaybackUriById.set(id, value);
}

export function clearCachedFeedVideoPlaybackUri(memoryId: string): void {
  const id = memoryId?.trim();
  if (!id) return;
  feedVideoPlaybackUriById.delete(id);
}
