/**
 * Intent « ajouter des favoris à un livre existant ».
 * Les params expo-router sur un onglet ne sont pas fiables depuis `book-preview` (stack → tab replace) :
 * on pose l’id juste avant la navigation, puis Favoris le consomme au focus.
 */
let pendingAddToBookId: string | null = null;

/** Session active sur Favoris (spread livre → ajout) : masque la tab bar. */
let activeAddToBookSessionId: string | null = null;
const sessionListeners = new Set<() => void>();

function notifySessionListeners(): void {
  sessionListeners.forEach(listener => listener());
}

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

/** Début / fin du flux Favoris depuis l’aperçu livre (spread). */
export function setFavorisAddToBookSession(bookId: string | null): void {
  const next = bookId?.trim() || null;
  if (activeAddToBookSessionId === next) return;
  activeAddToBookSessionId = next;
  notifySessionListeners();
}

export function peekFavorisAddToBookSession(): string | null {
  return activeAddToBookSessionId;
}

export function subscribeFavorisAddToBookSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

export function clearFavorisAddToBookSession(): void {
  setFavorisAddToBookSession(null);
}
