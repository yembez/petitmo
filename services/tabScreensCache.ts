import type { Child, Memory } from '@/types/local';
import type { Book } from '@/services/books';

/**
 * Cache partagé entre onglets : rempli au démarrage (`hydrateTabScreensFromLocal`)
 * et tenu à jour par `useFeedData` pour éviter roues de chargement à l’ouverture.
 */
export let feedChildHydrationSnapshot: Child | null = null;
export let feedMemoriesHydrationSnapshot: Memory[] = [];
export let feedBooksHydrationSnapshot: Book[] = [];

export function setFeedHydrationSnapshots(
  child: Child | null,
  memories: Memory[],
  books: Book[]
): void {
  feedChildHydrationSnapshot = child;
  feedMemoriesHydrationSnapshot = memories;
  feedBooksHydrationSnapshot = books;
}
