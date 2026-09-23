# Cycle de vie abonnement, inactivité & rétention

> **Règle d’or V2** : compte + sync limitée ; local-first — l’UI ne ressent jamais la sync.  
> Cross-refs : [`AGENTS.md`](../../AGENTS.md) · [`qr-media-retention.md`](./qr-media-retention.md) · [`qr-media-permanence.md`](./qr-media-permanence.md) · webhook [`revenuecat-webhook`](../../supabase/functions/revenuecat-webhook/index.ts).

**Décisions produit verrouillées (2026-09-16 V1 lecture totale)** — en code.

---

## 0. État actuel

| Sujet | Cible | Code |
|-------|-------|------|
| Expiration / refund RC | → `free` + `captureLocked` ; **tout visible** ; **0 ajout** | OK |
| `CANCELLATION` | Mail `sub.cancelled` (reste paid jusqu’à EXPIRATION) | OK |
| `BILLING_ISSUE` | E-mail + bandeau (pas de downgrade) | OK |
| Grâce 2 mois | **Abandonnée** | N/A |
| Archive >50 à l’expiration | **Abandonnée V1** (fair-play Day One / Qeepsake) | Stoppé |
| Never-paid free | Cap **50** + quotas vidéo | OK |
| Inactivité 24 mois + alertes | Oui | Code + Edge ; cron à brancher |
| Delete volontaire vs inactivité (QR) | Deux modes | OK |

---

## 1. Fin d’abonnement Petit Cœur (V1)

### Politique

1. **Fin d’accès store** (`EXPIRATION` / `REFUND`) → `subscriptionTier=free` + `captureLocked=true`.
2. **Tous** les souvenirs restent **visibles** (fil / favoris / partage unitaire).
3. **Aucun nouvel ajout** (Capturer / import / écrire / audio) jusqu’au réabonnement.
4. Livre / PDF à l’acte restent possibles ; remise −10 % perdue.
5. Never-paid (jamais abonnée) : **pas** de `captureLocked` → plafond **50** inchangé.
6. **Pas** de période cadeau 2 mois (Apple garde l’accès jusqu’à fin de période via `CANCELLATION`).

### Ne pas confondre

- Annulation = `CANCELLATION` → mail info seulement.
- Downgrade produit = **à l’expiration réelle**.
- Pas d’export ZIP bulk en V1 ; livre/PDF = sortie durable.

---

## 2. Compte inactif (24 mois)

**Inactif** = aucune connexion ni action produit pendant **24 mois**.  
Toute activité remet `last_active_at = now()` et annule le calendrier d’alertes.

| Jalon | Action |
|-------|--------|
| **J−90** / **J−30** / **J−7** | E-mails Relance |
| **J0** | Suppression auto `mode=inactivity` |

---

## 3. Deux suppressions (QR)

| Cas | Souvenirs | QR livres (15 ans) |
|-----|-----------|---------------------|
| **Volontaire** | Supprimés | **Supprimés** |
| **Inactivité auto** | Supprimés | **Conservés** jusqu’à `expires_at` |

`delete-account` : body `{ mode: 'voluntary' | 'inactivity' }` (défaut `voluntary`).

---

## 4. Mails Resend

| Id | Déclencheur |
|----|-------------|
| `sub.billing_issue` | `BILLING_ISSUE` RC |
| `sub.cancelled` | `CANCELLATION` RC |
| `sub.downgraded` | EXPIRATION/REFUND (lecture totale + 0 ajout) |
| `sub.reactivated` | Re-subscribe |
| `inactive.j90` / `j30` / `j7` / `deleted` | Cron inactivité |

---

## 5. Mapping RevenueCat

| Event | Action |
|-------|--------|
| Purchase / Renewal / Uncancellation / … | `paid` + clear `captureLocked` + restore archives legacy + mail reactivated si venait de free |
| `CANCELLATION` | E-mail `sub.cancelled` (reste paid) |
| `BILLING_ISSUE` | E-mail + flag |
| `EXPIRATION` / `REFUND` | `free` + `captureLocked` + restore archives legacy + mail downgraded |

---

## 6. Données

- `app_metadata.captureLocked` (+ cache AsyncStorage `petitmo:captureLocked`)
- `memories.archived_at` : legacy seulement (plus posé à l’expiration V1)
- Fil : souvenirs actifs ; restore legacy au webhook / au changement de tier UX

---

## 7. Roadmap

### P1 — Downgrade lecture totale (V1)

- [x] Spec sans grâce + lecture totale ex-paid
- [x] Flag `captureLocked` + gates Capturer
- [x] Stop archivage webhook + miroir local
- [x] Mails cancelled / downgraded / reactivated alignés
- [ ] Smoke EXPIRATION → tout visible + 0 ajout

### P2 — Inactivité

- [x] Table `account_activity` + Edge `touch-activity`
- [x] Edge `inactivity-sweep` (mails J−90/30/7 + delete inactivity)
- [x] Client touch fond (AppState / login)
- [ ] Brancher cron quotidien (Supabase scheduled function ou curl externe) → `POST …/inactivity-sweep` + Bearer `INACTIVITY_CRON_SECRET`

### P3 — Export / QR

- [ ] Export local Share / ZIP plafonné (plus tard)
- [ ] Purge `archive/` + DELETE tokens en mode voluntary
