import { peekHasRealAuthAccount } from '@/lib/authAccount';
import { listLocalChildren, listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';

/** Plusieurs enfants sur le compte connecté (SQLite, sans réseau). */
export function signedInAccountHasSeveralChildren(): boolean {
  if (!peekHasRealAuthAccount()) return false;
  const uid = peekLastRealAuthUserId();
  const count = uid
    ? listLocalChildrenForUser(uid).length
    : listLocalChildren().filter(c => !(c.user_id ?? '').trim()).length;
  return count > 1;
}
