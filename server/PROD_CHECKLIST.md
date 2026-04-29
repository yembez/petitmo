## Checklist prod — Railway (petitmo-pdf-server)

### 1) Variables d’environnement (Railway)

Obligatoires (le service refuse de démarrer sinon) :

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Optionnelles :

- `PORT` (défaut `8787`)
- `TRUST_PROXY` (`1` ou `true` si derrière proxy Railway pour que le rate-limit voie la vraie IP)

### 2) Vérifier le service

- **Healthcheck** :

```bash
curl -sS "<RAILWAY_URL>/health"
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

#### 4.2) Générer le PDF via Railway (ticket)

```bash
curl -sS "<RAILWAY_URL>/v1/books/generate-pdf" \\
  -H "content-type: application/json" \\
  -H "authorization: Bearer <pdfTicket>" \\
  --data '{
    "bookId":"test-book",
    "childId":"child-local",
    "coverTitle":"Test",
    "coverYearLabel":"Avril 2026",
    "chapterTitle":"Notre histoire",
    "qrBaseUrl":"<RAILWAY_URL>",
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

### 5) Mode print (fond perdu 3mm)

- Le **mode print** est supporté **uniquement** via ticket `export_print` (commande `print_order`).
- Côté HTML, les pages photo pleine appliquent un “bleed” de **3mm** (`top/left=-3mm`, taille `+6mm`).

