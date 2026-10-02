# Cycle de vie abonnement, inactivité & rétention

> **Règle d’or V2** : compte + sync limitée ; local-first — l’UI ne ressent jamais la sync.  
> Cross-refs : [`AGENTS.md`](../../AGENTS.md) · [`qr-media-retention.md`](./qr-media-retention.md) · [`qr-media-permanence.md`](./qr-media-permanence.md) · webhook [`revenuecat-webhook`](../../supabase/functions/revenuecat-webhook/index.ts).

**Décisions produit (2026-09-30)** — expiration = **plan gratuit** (50), pas lecture seule.

---

## 0. État actuel

| Sujet | Cible | Code |
|-------|-------|------|
| Expiration / refund RC | → `free` ; **tout visible** ; ajouts dans le **plafond 50** | OK |
| `CANCELLATION` | Mail `sub.cancelled` (reste paid jusqu’à EXPIRATION) | OK |
| `BILLING_ISSUE` | E-mail + bandeau (pas de downgrade) | OK |
| Grâce 2 mois | **Abandonnée** | N/A |
| Archive >50 à l’expiration | **Abandonnée** (fair-play Day One / Qeepsake) | Stoppé |
| Never-paid free | Cap **50** + durées A/V | OK |
| Ex-paid free | **Même** cap 50 (plus de `captureLocked` bloquant) | OK |
| Inactivité 24 mois + alertes | Oui | Code + Edge ; cron à brancher |
| Delete volontaire vs inactivité (QR) | Deux modes | OK |

---

## 1. Fin d’abonnement Petit Cœur

### Politique

1. **Fin d’accès store** (`EXPIRATION` / `REFUND`) → `subscriptionTier=free` + **`captureLocked=false`** (clear).
2. **Tous** les souvenirs restent **visibles** (fil / favoris / partage unitaire) — pas d’archivage >50.
3. **Ajouts** : mêmes règles que le gratuit never-paid — jusqu’à **50** souvenirs ; si déjà ≥50 (période paid), il faut supprimer pour repasser sous le plafond.
4. Livre / PDF à l’acte restent possibles ; remise −10 % perdue.
5. **Pas** de période cadeau 2 mois (Apple garde l’accès jusqu’à fin de période via `CANCELLATION`).

### Historique

- 2026-09-16 : modèle « lecture totale + 0 ajout » (`captureLocked`) — **abandonné** 2026-09-30 au profit du plan gratuit 50.

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
| `sub.downgraded` | EXPIRATION/REFUND (retour gratuit 50) |
| `sub.reactivated` | Re-subscribe |
| `inactive.j90` / `j30` / `j7` / `deleted` | Cron inactivité |

---

## 5. Mapping RevenueCat

| Event | Action |
|-------|--------|
| Purchase / Renewal / Uncancellation / … | `paid` + clear `captureLocked` + restore archives legacy + mail reactivated si venait de free |
| `CANCELLATION` | E-mail `sub.cancelled` (reste paid) |
| `BILLING_ISSUE` | E-mail + flag |
| `EXPIRATION` / `REFUND` | `free` + clear `captureLocked` + restore archives legacy + mail downgraded |

---

## 6. Données

- `app_metadata.captureLocked` : **legacy** — plus posé à `true` à l’expiration ; clear sur tout event tier. Cache AsyncStorage `petitmo:captureLocked` éventuel (CTA soft seulement).
- `memories.archived_at` : legacy seulement (plus posé à l’expiration)
- Fil : souvenirs actifs ; restore legacy au webhook / au changement de tier UX

---

## 7. Roadmap

### P1 — Downgrade → gratuit 50

- [x] Spec sans grâce + tout visible
- [x] Plus de gate `captureLocked` sur Capturer (plafond 50 uniquement)
- [x] Webhook clear `captureLocked` à EXPIRATION/REFUND
- [x] Mails cancelled / downgraded / reactivated alignés
- [ ] Smoke EXPIRATION → visible + ajouts si &lt; 50
- [ ] Clear flags résiduels `captureLocked=true` en prod (comptes sandbox)

### P2 — Inactivité

- [x] Table `account_activity` + Edge `touch-activity`
- [x] Edge `inactivity-sweep` (mails J−90/30/7 + delete inactivity)
- [x] Client touch fond (AppState / login)
- [ ] Brancher cron quotidien (Supabase scheduled function ou curl externe) → `POST …/inactivity-sweep` + Bearer `INACTIVITY_CRON_SECRET`

### P3 — Export / QR

- [ ] Export local Share / ZIP plafonné (plus tard)
- [ ] Purge `archive/` + DELETE tokens en mode voluntary
