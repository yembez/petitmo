# Tarification V1 — règles canoniques & matrice de migration

> **Règle d’or** : mode local gratuit (SQLite + sandbox) ; cloud limité (commande livre imprimée + QR audio/vidéo après paiement).  
> **V1** : pas de monétisation export PDF ; impression + abonnement Petitmo+ uniquement.

Décisions produit validées (2026) :

| Entrée | Règle |
|--------|--------|
| **Pages (tarif)** | `gelatoCatalogPageCount(pages)` — **le même compteur que Gelato** (intérieur pair, ≥ 30 min impression). Voir `utils/bookGelatoInnerPages.ts` / `server/src/gelato/photobookLayout.ts`. |
| **QR facturables** | Nombre de **pages livre** de type **audio** ou **vidéo** (une page = un QR imprimé). |
| **QR inclus (gratuit)** | **2** au total (mix audio / vidéo libre). |
| **Supplément QR (gratuit)** | `max(0, qrCount − 2) × 0,70 € TTC`. |
| **Composition livre A/V** | **Pas de plafond 5+5** : on peut ajouter autant d’audio/vidéo que voulu en aperçu. La monétisation QR se fait **uniquement au checkout** (2 inclus + 0,70 €). |
| **Petitmo+** | QR **illimités** (0 € supplément) ; **−10 %** sur la partie « livre » (base + pages supplémentaires, **pas** de ligne QR négative). |
| **Abo** | 5,99 €/mois · 49,99 €/an — mêmes avantages. |
| **Export PDF** | **Hors scope V1** (UI / paywall / achat à l’acte retirés ou masqués ; pas de nouveau flux QR « export PDF payant »). |

---

## Formules (source de vérité à implémenter)

```text
gelatoPages = gelatoCatalogPageCount(pages)
qrCount     = count(pages where type in { audio, video })

extraPages  = max(0, gelatoPages - 30)
bookPart    = 39.00 + extraPages × 0.70

extraQr     = tier === paid ? 0 : max(0, qrCount - 2)
qrPart      = extraQr × 0.70

subtotal    = bookPart + qrPart
total       = tier === paid ? round2(subtotal × 0.90) : round2(subtotal)
```

**Exemple (gratuit, 45 pages Gelato, 8 QR A/V)**  
- Livre : 39 + 15×0,70 = **49,50 €**  
- QR : (8−2)×0,70 = **4,20 €**  
- **Total 53,70 €**

**Upsell affiché (gratuit)**  
- Livre Petitmo+ : 49,50 × 0,90 = **44,55 €**  
- QR inclus : **−4,20 €** (ligne informative)  
- **Total Petitmo+ 44,55 €** · **Économie 9,15 €**

---

## Écart avec l’existant (code actuel)

| Zone | Aujourd’hui | V1 |
|------|-------------|-----|
| Pages tarif | `billable_pages` = **souvenirs** (min **20** facturées) | **Gelato catalogue** (base **30**) |
| Prix pages | 32 € + paliers 1,20 / 1,00 | 39 € + **0,70**/page > 30 |
| QR | Pas de ligne prix ; quotas **5 audio + 5 vidéo** / livre (blocage composition) | **Pas de plafond composition** ; **2 inclus** puis **0,70 €**/QR au checkout (gratuit) |
| Remise abo print | **−20 %** | **−10 %** (QR non remisés, inclus abo) |
| PDF digital | **4,99 €** + paywall `EXPORT_DIGITAL_PDF` | **Retiré V1** |
| Souvenirs gratuit | `FREE_TIER_LIMIT = 20` (dev) | **50** (prod) |

---

## Matrice de migration par couche

Légende : **P0** = bloquant cohérence prix · **P1** = UX / conversion · **P2** = doc / nettoyage · **P3** = optionnel V1.1

### A. Constantes & calcul (une seule implémentation miroir)

| Fichier | Action | Priorité |
|---------|--------|----------|
| **`lib/pricingV1.ts`** (nouveau) | Constantes + `quotePrintOrderV1({ gelatoPages, qrCount, tier })` → `{ bookPart, qrPart, total, lines, premiumUpsell }` | **P0** |
| **`lib/printedBookQuote.ts`** | Remplacer formule legacy ou déléguer à `pricingV1` ; supprimer paliers 32/1,20/1,00 | **P0** |
| **`supabase/functions/init-export/calculateBookPrice.ts`** | Même formule + centimes ; accepter `gelato_pages` + `qr_count` (ou recalcul serveur) | **P0** |
| **`server/src/pricing/printedBookQuote.ts`** | Aligner sur `lib/pricingV1` (copie miroir ou import partagé si build le permet) | **P0** |
| **`utils/bookGelatoInnerPages.ts`** | Mettre à jour le commentaire L9 (« Facturation = souvenirs… ») → **facturation = Gelato catalogue** | **P2** |

**Tests P0** : unitaires sur 30/0 QR, 45/6 QR, 45/8 QR, paid vs free ; parité client ↔ Edge ↔ server.

---

### B. Commande livre (`print_order`)

| Fichier | Action | Priorité |
|---------|--------|----------|
| **`app/book-preview.tsx`** | Navigation commande : envoyer **`gelatoPageCount`** (déjà partiel) ; **`billable_pages`** → renommer sémantique ou passer **`gelatoPages` only** ; `avPageCount` = `qrCount` | **P0** |
| **`app/book-order.tsx`** | Tarif via `quotePrintOrderV1` ; récap lignes (livre / QR / total) ; bannière **−10 %** (plus −20 %) ; supprimer texte « min 20 facturées » | **P0** |
| **`services/printBookOrder.ts`** | Payload `init-export` : `gelato_pages`, `qr_count`, `discount_percent: 10 \| 0` ; recalcul prix côté Edge **obligatoire** (ne pas faire confiance au client) | **P0** |
| **`supabase/functions/init-export/index.ts`** | Valider `gelato_pages` (≥ 30 pour print ?), `qr_count` ; `discount_percent` **0 ou 10** (plus 20) ; persister breakdown si colonnes ajoutées | **P0** |
| **`supabase/migrations/…sql`** | Option : `gelato_pages`, `qr_count`, `price_book_cents`, `price_qr_cents` sur `export_requests` (sinon recalcul depuis champs existants + log) | **P1** |

**Sécurité P0** : l’Edge recalcule `price_cents` à partir de `gelato_pages` + `qr_count` + tier JWT/metadata — jamais le montant envoyé par l’app.

---

### C. Limites gratuit & composition livre

**Décision validée** : assouplir le **5+5** — **aucune limite de composition** sur le nombre de pages audio/vidéo dans le livre. Facturation QR **uniquement au checkout** (`2` inclus + `0,70 €` / QR au-delà, gratuit ; illimité Petitmo+). Les quotas **fil** (ex. 5 vidéos / 5 audios *souvenirs* en gratuit) restent inchangés.

| Fichier | Action | Priorité |
|---------|--------|----------|
| **`lib/limits.ts`** | `FREE_TIER_LIMIT` → **50** (prod) ; retirer / déprécier `FREE_TIER_BOOK_AUDIO_MAX_COUNT`, `FREE_TIER_BOOK_VIDEO_MAX_COUNT`, `FREE_TIER_BOOK_QR_AV_MAX_PER_BOOK` (plus de plafond livre) | **P0** |
| **`services/books.ts`** `validateFreeTierBookMemoryLimits` | **Supprimer** le blocage 5+5 (ou no-op) ; ne plus empêcher d’ajouter A/V au livre | **P0** |
| **`app/book-order.tsx`** | Retirer l’appel bloquant à `validateFreeTierBookMemoryLimits` avant commande ; laisser `quotePrintOrderV1` facturer les QR | **P0** |
| **`docs/specs/free-tier-book-qr-av.md`** | Remplacer « 5+5 QR / export PDF payant » par **composition libre + 2 QR inclus + 0,70 €** ; QR cloud **après commande imprimée** (plus export PDF V1) | **P0** |
| **`server/src/constants/spec.ts`** | Retirer ou rendre non bloquant `FREE_TIER_QR_AV_MAX_PER_BOOK` (ne plus refuser un livre > 10 A/V) | **P0** |
| **`server/src/pdf/prepareQrForBook.ts`** / **`preparePublicTokens.ts`** | Idem — plus de `throw` / 400 sur `avCount > 10` en free ; facturation = checkout | **P0** |
| **`AGENTS.md`** | « max 5 par livre » → composition libre, monétisation au checkout | **P2** |

---

### D. Export PDF (hors V1)

| Fichier | Action | Priorité |
|---------|--------|----------|
| **`app/book-preview.tsx`** | Masquer / retirer CTA export PDF numérique ; `goToBookOrderPdf`, paywall `EXPORT_DIGITAL_PDF` | **P1** |
| **`app/paywall.tsx`** | Retirer ou `#ifdef` contexte `EXPORT_DIGITAL_PDF` et achat 4,99 € | **P1** |
| **`lib/bookExportPricing.ts`** | Déprécier `DIGITAL_EXPORT_PDF_EUR` ou commentaire « V2 » | **P2** |
| **`lib/digitalExportPurchase.ts`** | Ne plus appeler en parcours nominal ; garder pour restauration legacy | **P2** |
| **`supabase/functions/init-export/index.ts`** | `pdf_export` : laisser en base pour legacy, pas de nouveau parcours app | **P2** |
| **`AGENTS.md`** | Retirer exception hero export PDF ; préciser V1 print-only + abo | **P2** |

**QR sans PDF V1** : en gratuit, les médias A/V du livre ne deviennent « vivants » qu’**après commande imprimée payée** (exception cloud inchangée, sans branche export PDF).

---

### E. Abonnement (5,99 / 49,99)

| Fichier | Action | Priorité |
|---------|--------|----------|
| **`app/paywall.tsx`** | Déjà 5,99 / 49,99 — brancher **IAP RevenueCat** (aujourd’hui simulé) | **P3** (prod) |
| **`supabase/functions/…` webhook RC** | `subscriptionTier: paid` → remise print **10 %** côté `init-export` | **P0** (avec tarif) |
| **Copy marketing** | « −20 % impression » → **−10 %** + **QR illimités** partout (bannière commande, etc.) | **P1** |

---

### F. Affichage récap & conversion (spec §4)

| Fichier | Action | Priorité |
|---------|--------|----------|
| **`app/book-order.tsx`** | Composant récap : lignes livre / QR / total ; bloc **Avec Petitmo+** (économie chiffrée) si `tier === free` | **P1** |
| **(option)** **`components/BookOrderPriceBreakdown.tsx`** | UI réutilisable + tests snapshot | **P1** |
| **Aperçu livre** | Badge discret « X QR · Y inclus » avant commande (évite surprise checkout) | **P2** |

---

### G. Gelato & PDF serveur (pas de changement tarif, cohérence compteur)

| Fichier | Action | Priorité |
|---------|--------|----------|
| **`server/src/gelato/placePrintOrder.ts`** | Déjà `gelatoPageCount` catalogue — vérifier = même fn que client | **P0** vérif |
| **`server/src/routes/generatePdf.ts`** | Logs / metadata : pas confondre `catalogPageCount` et ancien `billable_pages` | **P2** |

---

## Ordre d’implémentation recommandé

1. **`lib/pricingV1.ts`** + tests unitaires (parité formules spec).  
2. **`init-export`** + **`printBookOrder`** (serveur recalcule, discount 10).  
3. **`book-order`** récap + upsell Petitmo+.  
4. **`book-preview`** params (`gelatoPageCount`, `qrCount`) uniquement.  
5. Limites **50** souvenirs + doc **`free-tier-book-qr-av.md`** + retrait plafond 5+5.  
6. Retrait PDF V1 (UI export).  
7. Copy −20 % → −10 % / QR illimités.

**Statut implémentation (2026-07)** : P0 + P1 principaux **faits** dans le code (`lib/pricingV1.ts`, Edge, `book-order`, limites, menu export). Reste : déployer Edge `init-export` + smoke commande réelle.

---

## Checklist QA (release)

- [ ] 30 pages Gelato, 0 QR → **39,00 €** (gratuit) / **35,10 €** (abo).  
- [ ] 45 pages, 6 QR gratuit → **53,70 €** ; upsell abo **44,55 €**, économie **9,15 €**.  
- [ ] Abo : 8 QR, 45 pages → **44,55 €** (pas de ligne QR).  
- [ ] Edge rejette `discount_percent: 20` ; accepte **10** si tier paid.  
- [ ] Compteur pages commande = header spread (Gelato), pas « pages souvenir ».  
- [ ] Pas de parcours export PDF payant en V1.  
- [ ] Gratuit : 50ᵉ souvenir autorisé, 51ᵉ → paywall `LIMIT_REACHED`.  
- [ ] Gratuit : livre avec **> 5** vidéos (ou **> 10** A/V) **ajoutable** en aperçu ; checkout facture `max(0, qrCount − 2) × 0,70 €` ; pas d’erreur 5+5.  
- [ ] Serveur PDF / tokens : livre free avec **12** pages A/V **accepté** (plus de plafond 10).

---

## Risques à surveiller

1. **Renommer `billable_pages`** en base : migration douce (remplir avec `gelato_pages` pour nouvelles commandes ; anciennes lignes legacy).  
2. **Volume QR cloud** : sans plafond composition, un livre gratuit peut générer beaucoup de tokens/transcodes après paiement — surveiller coût infra ; éventuellement plafond soft / alerte ops en V1.1 (hors monétisation).  
3. **Marge** : valider 0,70 € / page et / QR vs coût Gelato + transcode (hors scope code, décision business).  
4. **Quotas fil ≠ livre** : une utilisatrice gratuite peut être bloquée à **5 vidéos fil** tout en ayant déjà 5 vidéos dans un livre — clarifier UX si elle veut une 6ᵉ vidéo (paywall fil, pas livre).

---

## Fichiers couplés (référence rapide)

```
lib/pricingV1.ts                    ← NEW (canon)
lib/printedBookQuote.ts
lib/limits.ts
lib/bookExportPricing.ts            ← deprec V1
utils/bookGelatoInnerPages.ts
app/book-preview.tsx
app/book-order.tsx
app/paywall.tsx
services/printBookOrder.ts
services/books.ts
supabase/functions/init-export/
supabase/functions/init-export/calculateBookPrice.ts
server/src/pricing/printedBookQuote.ts
server/src/gelato/placePrintOrder.ts
docs/specs/free-tier-book-qr-av.md
AGENTS.md
```
