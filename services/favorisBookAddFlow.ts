/**
 * Intent « ajouter des favoris à un livre existant ».
 * Les params expo-router sur un onglet ne sont pas fiables depuis `book-preview` (stack → tab replace) :
 * on pose l’id juste avant la navigation, puis Favoris le consomme au focus.
 */
let pendingAddToBookId: string | null = null;

export function setPendingFavorisAddToBookId(bookId: string): void {
  const id = bookId.trim();
  pendingAddToBookId = id || null;
}

export function peekPendingFavorisAddToBookId(): string | null {
  return pendingAddToBookId;
}

/** Lecture unique au focus Favoris (évite double application Strict Mode). */
export function consumePendingFavorisAddToBookId(): string | null {
  const id = pendingAddToBookId;
  pendingAddToBookId = null;
  return id;
}

export function clearPendingFavorisAddToBookId(): void {
  pendingAddToBookId = null;
}
