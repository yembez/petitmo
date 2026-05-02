# petitmo-pdf-server

Service Node (Express) pour **QR médias livre** et, plus tard, **génération PDF** (Playwright).

## Règles

- **Ne jamais** importer le code Expo (`app/`, `expo-*`, `react-native`).
- Contrats types : `/types/shared.ts` (app) ; copie alignée dans `src/types/contracts.ts` pour le build isolé.

## Variables d’environnement

| Variable | Obligatoire | Description |
|----------|-------------|-------------|
| `SUPABASE_URL` | oui | URL projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | Clé service (serveur uniquement) |
| `EXPORT_PDF_JWT_SECRET` | oui* | Même secret que l’Edge Function `init-export` (JWT ticket PDF, min. 32 car.) — requis si flux sans compte |
| `PORT` | non | Défaut `8787` (Railway injecte `PORT`) |
| `TRUST_PROXY` | non | `true` si derrière proxy (rate limit IP correct) |

\*Sans ce secret, la vérification du ticket échoue silencieusement et seul le flux **session Supabase** fonctionne pour `POST /v1/books/generate-pdf`.

## Développement local

```bash
cd server
npm install
export SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="..."
npm run dev
```

- Santé : `GET http://localhost:8787/health`
- QR : `GET http://localhost:8787/q/:token` → **302** vers signed URL Storage (120 s)

## Docker (contexte = ce dossier)

```bash
cd server
docker build -t petitmo-pdf-server .
docker run --rm -p 8787:8787 \
  -e SUPABASE_URL=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e PORT=8787 \
  petitmo-pdf-server
```

## Déploiement (Railway ou VPS)

- **Railway** : guide pas à pas [**DEPLOY_RAILWAY.md**](./DEPLOY_RAILWAY.md) (`railway.toml`, healthcheck, variables).
- **VPS (ex. Hetzner)** : [**DEPLOY_HETZNER.md**](./DEPLOY_HETZNER.md) + script `scripts/deploy-pdf-server-hetzner.sh`.
- **Vue d’ensemble** : [**DEPLOY.md**](../DEPLOY.md) à la racine du monorepo.

## Supabase

Appliquer les migrations :

- `supabase/migrations/20260426190000_create_qr_links.sql`
- `supabase/migrations/20260427200000_create_qr_links_exports.sql`

Créer le bucket privé **`qr-media`** (si absent) ; les lignes `qr_links` et `qr_links_exports` référencent `storage_bucket` + `media_path`. La route `GET /q/:token` résout d’abord `qr_links`, puis `qr_links_exports`.

### Export sans compte (ticket)

1. Déployer l’Edge Function `init-export` et définir le secret **`EXPORT_PDF_JWT_SECRET`** (identique sur le serveur PDF déployé — Railway, VPS, etc.).
2. `POST .../functions/v1/init-export` :
   - **`type: "pdf_export"`** : `export_mode` (`digital`|`print`), `book_id`, `email`, `gdpr_consent_at`, `subscription_tier` (`free`|`paid`), `audio_video_page_count`, etc. → réponse `pdfTicket`, `exportRequestId`, `flow: "pdf_export"`.
   - **`type: "print_order"`** : mêmes champs communs + `export_mode: "print"`, `shipping_name`, `shipping_address_json` (`line1`, `city`, `zip`, `country`, `line2?`), `page_count` (20 \| 40 \| 60), `price_cents`, optionnel `discount_percent` (0 \| 20), `printer_name`. → réponse `exportRequestId`, `flow: "print_order"` (**pas** de `pdfTicket` ; paiement / PDF impression à brancher ensuite).
3. `POST /v1/books/generate-pdf` avec `Authorization: Bearer <pdfTicket>` (PDF seulement) et payload incluant **`guestChild`**, **`guestMemories`** (souvenirs avec URLs / chemins accessibles au service role), alignés sur `export_requests` (même `bookId`, `exportMode`, `subscriptionTier` free↔premium selon paid).

### App — commande livre imprimé

- Écran **`/book-order`** (params `bookId`, `childId`, `memoryPageCount`, `avPageCount`) : tarif spec §6 (`lib/printedBookQuote.ts`), formulaire livraison + consentement, appel **`init-export`** `print_order` via `services/printBookOrder.ts`.
- Depuis **`/book-preview`** : action **« Commander l’imprimé »** dans la même alerte que les exports PDF.
