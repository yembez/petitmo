### Petitmo media worker (serveur)

But: générer **une seule fois** des variantes d'images/vidéos (thumb/display/print + poster vidéo) et supprimer les objets Storage liés à un souvenir, afin de réduire drastiquement l'egress Supabase.

#### Variables d'environnement

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `MEDIA_WORKER_SECRET` (doit matcher `MEDIA_WORKER_SECRET` des Edge Functions)
- `PORT` (défaut `8788`)

#### Lancer en local

Depuis `server/media-worker/`:

```bash
npm install
npm run start
```

#### Endpoints

- `POST /process-memory` `{ "memoryId": "..." }`
- `POST /delete-memory-assets` `{ "memoryId": "..." }`

Les Edge Functions Supabase (`process-memory`, `delete-memory-assets`) appellent ce worker avec un header `X-Worker-Secret`.

