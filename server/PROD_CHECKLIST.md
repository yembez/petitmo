## Checklist prod — petitmo-pdf-server

S’applique à **tout** déploiement du service PDF (Railway, VPS Docker, etc.) : remplacer `<PUBLIC_PDF_URL>` par l’URL HTTPS réelle.

### 1) Variables d’environnement (hébergeur)

Obligatoires (le service refuse de démarrer sinon) :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optionnelles :

- `PORT` (défaut `8787` ; sur Railway laisser la valeur injectée par la plateforme)
- `TRUST_PROXY` (`1` ou `true` si derrière reverse proxy — Railway, Nginx, etc.)

### 2) Vérifier le service

- **Healthcheck** :

```bash
curl -sS "<PUBLIC_PDF_URL>/health"
```

Attendu :

```json
{ "ok": true, "service": "petitmo-pdf-server" }
```

### 3) Pré-requis Supabase (Edge Functions)

Sur Supabase (Edge `init-export`) :

- `verify_jwt = false` (déjà dans `supabase/config.toml`)
- Secret requis dans les variables de la fonction :
  - `EXPORT_PDF_JWT_SECRET` (min 32 caractères)
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

### 4) Smoke test bout-en-bout (init-export → ticket → generate-pdf)

#### 4.1) Créer un ticket PDF export (Edge `init-export`)

```bash
curl -sS "<SUPABASE_URL>/functions/v1/init-export" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer <SUPABASE_ANON_KEY>" \\
  -H "apikey: <SUPABASE_ANON_KEY>" \\
  --data '{
    "type":"pdf_export",
    "export_mode":"digital",
    "book_id":"test-book",
    "child_local_id":"child-local",
    "subscription_tier":"paid",
    "audio_video_page_count":0,
    "email":"test@example.com",
    "gdpr_consent_at":"'"$(date -u +"%Y-%m-%dT%H:%M:%SZ")"'",
    "full_name":"Test",
    "marketing_opt_in":false
  }'
```

Récupérer :

- `pdfTicket`
- `exportRequestId`

#### 4.2) Générer le PDF via le serveur public (ticket)

```bash
curl -sS "<PUBLIC_PDF_URL>/v1/books/generate-pdf" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer <pdfTicket>" \\
  --data '{
    "bookId":"test-book",
    "childId":"child-local",
    "coverTitle":"Test",
    "coverYearLabel":"Avril 2026",
    "chapterTitle":"Notre histoire",
    "qrBaseUrl":"<PUBLIC_PDF_URL>",
    "exportMode":"digital",
    "subscriptionTier":"premium",
    "digitalExportPaid": true,
    "coverPhotoUrl": null,
    "pages":[
      { "type":"cover", "child": { "name":"Lina", "photo_url": null } },
      { "type":"chapter", "month":"avril", "chapterNum":1 },
      { "type":"back-cover" }
    ],
    "guestChild": { "name":"Lina", "photo_url": null },
    "guestMemories":[]
  }'
```

Attendu :

- `pdfUrlSigned` (URL signée Supabase Storage)
- `pdfStoragePath` (peut être `null` si fichier non persistant)

#### 4.2bis) (Optionnel) Signer des URLs d’upload direct Storage (Edge `guest-upload-urls`)

Pré-requis :

- Déployer l’Edge Function `guest-upload-urls`
- Dans Supabase: `verify_jwt = false` (dans `supabase/config.toml`)
- Variables Edge:
  - `EXPORT_PDF_JWT_SECRET`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`

```bash
curl -sS "<SUPABASE_URL>/functions/v1/guest-upload-urls" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer <SUPABASE_ANON_KEY>" \\
  -H "apikey: <SUPABASE_ANON_KEY>" \\
  --data '{
    "pdfTicket":"<pdfTicket>",
    "assets":[
      { "kind":"cover" },
      { "kind":"photo", "memoryId":"mem-1" },
      { "kind":"audio", "memoryId":"mem-2" },
      { "kind":"video_thumb", "memoryId":"mem-3" },
      { "kind":"video", "memoryId":"mem-3" }
    ]
  }'
```

Attendu :

- `uploads[]` avec `signedUrl` + `bucket` + `path`
- Pour `cover/photo/video_thumb` : `publicUrl` (bucket `media`)
- Pour `audio/video` : `token` (stable pour QR) + `path` raw (bucket `qr-media`)

#### 4.3) Télécharger le PDF et vérifier qu’il s’ouvre

```bash
curl -L "<pdfUrlSigned>" -o out.pdf
open out.pdf
```

### 5) Mode print (fond perdu 4 mm Gelato)

- Le **mode print** est supporté **uniquement** via ticket `export_print` (commande `print_order`).
- Page PDF : **218×288 mm** (trim 210×280 + 4 mm de chaque côté).
- Côté HTML, `--bleed` = 4 mm ; les visuels `.bleed-x` débordent sur le fond perdu.

