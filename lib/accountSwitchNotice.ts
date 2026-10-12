/**
 * Notice one-shot après purge d’isolation (changement de compte).
 * Si le nouveau compte cloud est vide, l’UI peut orienter vers l’e-mail précédent
 * au lieu de laisser croire que le profil SQLite a « disparu ».
 */

export type AccountSwitchNotice = {
  reason: string;
  prevUserId: string | null;
  prevEmail: string | null;
  nextUserId: string;
  localChildrenBefore: number;
};

let pending: AccountSwitchNotice | null = null;

export function setPendingAccountSwitchNotice(notice: AccountSwitchNotice): void {
  pending = notice;
}

export function consumePendingAccountSwitchNotice(): AccountSwitchNotice | null {
  const n = pending;
  pending = null;
  return n;
}

export function peekPendingAccountSwitchNotice(): AccountSwitchNotice | null {
  return pending;
}
