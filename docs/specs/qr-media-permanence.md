# Pérennité QR médias livre (`/m/{token}`)

> **Critique produit** : un QR imprimé ou exporté en PDF doit rester lisible pendant toute la durée de vie du souvenir (spec : **10 ans**).  
> Un ré-export ou une ouverture de l’app ne doit **jamais** invalider un token déjà servi.

## Invariants (non négociables)

1. **Un token par couple `(media_id, kind)`** — stable à vie (`public_media_tokens.media_kind_unique`).
2. **Le token dans le QR ne change pas** après le premier export qui l’a matérialisé.
3. **`status=ready` est terminal** — interdit de repasser à `pending_upload` / `failed` (trigger SQL `guard_public_media_token_ready`).
4. **`ready_path` immuable** une fois `ready` — chemin canonique `qr-media/ready/{token}.{m4a|mp4}`.
5. **Copie archive** — à la première mise en `ready`, copie vers `qr-media/archive/{token}.{ext}` (`upsert: false`, jamais écrasée).
6. **Guérison** — au scan `/m/{token}`, si la DB est incohérente mais que `ready/` ou `archive/` existe, restaurer `status=ready` (auto-heal).

## Stockage Supabase

| Chemin | Rôle | Lifecycle |
|--------|------|-----------|
| `qr-media/raw/{export_request_id}/…` | Source brute guest / transit | Peut être remplacé par export |
| `qr-media/ready/{token}.m4a\|mp4` | Fichier servi au scan QR | **Ne pas supprimer** ; `upsert` uniquement si re-transcode explicite (rare) |
| `qr-media/archive/{token}.m4a\|mp4` | Sauvegarde immuable | **Jamais supprimer** ; première écriture seulement |

## Traçabilité

Table `public_media_token_events` (migration `20260709180000_…`) :

- Trigger `log_public_media_token_status_change` sur chaque INSERT/UPDATE de statut.
- Logs applicatifs Railway : `[qr-permanence] …`
- Requête diagnostic token :

```sql
SELECT token, media_id, kind, status, ready_path, last_error, updated_at
FROM public_media_tokens WHERE token = '<TOKEN>';

SELECT created_at, event, detail
FROM public_media_token_events
WHERE token = '<TOKEN>'
ORDER BY created_at DESC
LIMIT 30;
```

## Règles d’implémentation (code)

| Fichier | Règle |
|---------|--------|
| `supabase/functions/guest-upload-urls` | Ne jamais `UPDATE` un token `ready` ; tenter heal avant nouveau raw |
| `server/src/pdf/linkPublicMediaTokenSource.ts` | Ne pas remplacer un token `ready` |
| `server/src/publicMedia/permanence.ts` | Module unique heal / archive / audit |
| `server/src/worker/publicMediaWorkerOnce.ts` | Utiliser `markPublicMediaTokenReady` |
| `services/bookQrPreview.ts` | Token SQLite local = cache UX ; vérité = `public_media_tokens` |

## Checklist avant merge (QR / export / Storage)

- [ ] Aucun `UPDATE` qui met `status` à `pending_upload` sans `.neq('status', 'ready')` ou équivalent
- [ ] Ré-export du même souvenir : scan d’un **ancien PDF** doit encore fonctionner
- [ ] Migration trigger appliquée en prod **avant** déploiement Railway qui écrit les tokens
- [ ] Smoke : `scripts/qa/smoke-qr-audio.sh` + rescan QR d’un PDF d’hier

## Parité déploiement

Comme `public_media_tokens` / Storage : toute migration sous `supabase/migrations/` doit être **appliquée en prod** avant ou avec le push Railway (`AGENTS.md` parité schéma).
