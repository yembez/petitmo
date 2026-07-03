# Audit release readiness — 02 juillet 2026

Règle d’or : **gratuit = SQLite + sandbox uniquement** ; **Petitmo+ = sync cloud en arrière‑plan**, UI **local‑first**.  
Paiement non négociable (Petitmo+) : **paywall → IAP confirmé → création compte → `Purchases.logIn` → webhook → `subscriptionTier=paid`** (voir `AGENTS.md`).

## Verdict (1 phrase)
**Pas lançable App Store en l’état** : l’export PDF serveur est prêt, mais **RevenueCat (abonnement) et Gelato (impression) ne sont pas intégrés**, et les **QR in‑app ne sont pas alignés** avec les tokens serveur.

---

## Cartographie rapide (où vivent les flux)

### PDF serveur (OK)
- `services/bookPdfServer.ts` : client export (session + ticket) + downloads.
- `supabase/functions/init-export/index.ts` : crée `export_requests`, émet `exportTicket` JWT.
- `server/src/routes/generatePdf.ts` : génération Playwright + storage.
- `server/PROD_CHECKLIST.md` : smoke tests curl + env vars.

### QR médias (implémenté serveur, QA E2E à faire)
- Système recommandé (nouveau) : `public_media_tokens`
  - migration : `supabase/migrations/20260429223000_create_public_media_tokens.sql`
  - route publique : `server/src/routes/publicMedia.ts` (`/m/:token`)
  - préparation tokens : `server/src/pdf/preparePublicTokens.ts`
  - worker : `server/src/worker/publicMediaWorkerOnce.ts` (raw → ready)
- ⚠️ In‑app book preview : QR affiché peut être **non aligné** (construction côté app vs tokens serveur).

### Impression (socle OK, intégration imprimeur manquante)
- UI : `app/book-order.tsx`, `app/book-order-confirmation.tsx`
- Init export : `services/printBookOrder.ts` + `supabase/functions/init-export/index.ts`
- DB : `supabase/migrations/20260427160000_create_crm_contacts_and_export_requests.sql`
- ⚠️ **Aucun appel API Gelato** ni webhook imprimeur dans le repo.

### Abonnement Petitmo+ (manquant)
- Paywall : `app/paywall.tsx` = **stub** (simule l’achat).
- Tier local : `lib/userTier.ts` (AsyncStorage = cache UX, pas preuve serveur).
- Mode : `lib/userMode.ts`
- ⚠️ **Aucun SDK RevenueCat** (`react-native-purchases`) ni webhook `subscriptionTier` implémenté.

---

## Score / statut par domaine (OK/KO)

| Domaine | Statut | Pourquoi |
|---|---:|---|
| Export PDF serveur | ✅ | Flux complet + checklist prod existante |
| QR médias (serveur) | 🟠 | Implémenté mais non testé E2E (pending→ready) |
| QR aperçu livre in‑app | 🔴 | Risque de mismatch (token vs `memory.id`) |
| Impression (commande) | 🟠 | Pré‑commande + PDF print OK, **Gelato manquant** |
| Abonnement Petitmo+ | 🔴 | RevenueCat/IAP + webhook absents ; paywall stub |
| Migration local→cloud | 🟠 | Gros flux à valider E2E (perte, favoris, médias) |
| Légal / Store | 🟠 | Politique de confidentialité/CGU + privacy labels à finaliser avant soumission |

---

## Blockers “release” objectifs

1) **RevenueCat / IAP absent**  
   - On ne peut pas sortir un abonnement sans IAP réel + restore + webhook serveur.

2) **Gelato absent** (si impression incluse en v1)  
   - Les tables prévoient `printer_order_id/json` mais rien ne remplit ces champs.

3) **QR in‑app non aligné tokens**  
   - Même si l’export PDF est correct, l’aperçu peut afficher un QR “faux”.

---

## Plan de tests E2E (à exécuter avant toute décision “release”)

### A. Smoke test PDF serveur (30 min)
Suivre `server/PROD_CHECKLIST.md` :
- `GET <PUBLIC_PDF_URL>/health` attendu `{ ok:true }`
- `init-export` → récupérer `pdfTicket`
- `generate-pdf` (ticket) → récupérer `pdfUrlSigned` → télécharger et ouvrir

### B. Test QR (1–2h)
Objectif : valider le cycle **pending → ready**.
- Générer un PDF avec au moins 1 page **audio** (et idéalement 1 page **vidéo** si tier premium).
- Scanner le QR sur **un autre téléphone** :
  - Page publique s’ouvre
  - Si “en préparation” : attendre puis refresh → devient “ready” et lecture OK
- Noter :
  - délais typiques
  - erreurs `last_error` (si besoin d’un petit outil admin)

### C. Test “commande impression” (sans Gelato pour l’instant) (1h)
Objectif : valider jusqu’au **PDF print** + stockage `export_requests`.
- Créer une commande print (adresse) → vérifier que `init-export` crée `export_requests`
- Générer le PDF print (ticket `export_print`) → vérifier rendu (218×288, bleed 4mm)
- Conclure : OK pour brancher Gelato ensuite

### D. Test migration cloud (1–2 jours)
Objectif : **zéro perte**.
- Dataset test : texte + photos + audio + vidéo + favoris
- Scénarios :
  - offline → online
  - redémarrage app pendant migration
  - réinstall + restauration (si identité cloud stable)

---

## Roadmap recommandée (2–4 semaines, risque faible)

### Semaine 1 : lever l’incertitude (QA E2E)
- Faire A/B/C/D ci‑dessus, noter les KO.
- Corriger en priorité : **QR in‑app aligné tokens** + bugs de migration.

### Semaine 2 : QR “prod‑grade”
- Monitoring worker `public_media_tokens` (un endpoint admin minimal ou logs).
- Clarifier l’unique système QR (déprécier `qr_links` si non utilisé).

### Semaine 3 : Gelato (si impression v1)
- Implémenter `place-print-order` (Edge function ou serveur) :
  - input : `export_request_id` + `pdf_storage_path` + shipping
  - output : `printer_order_id/json`
- Webhooks shipped/delivered → `export_requests.shipped_at/delivered_at`

### Semaine 4 : RevenueCat (abonnement v1)
- Ajouter `react-native-purchases` + init au 1er lancement
- Paywall : offerings → purchase + restore
- Après paiement confirmé : création compte Supabase → `Purchases.logIn` → webhook → `app_metadata.subscriptionTier`
- App : `userTier` = cache UX ; source de vérité = serveur

---

## Décisions produit à figer (avant implémentation)
- Impression en v1 : **oui/non** (si non, masquer UI “commander” et sortir PDF + cloud + QR)
- QR : domaine public final (`petitmo.app/m/...` vs URL serveur) + politique d’expiration
- Abonnement : mensuel/annuel (et “PDF à l’acte” maintenu ou non)

