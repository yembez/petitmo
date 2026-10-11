# Push — rappel capture quotidien (ops)

## Produit
- Opt-in **OFF** par défaut (App Store / confiance).
- UI : Espace parent → Application → **Rappel du soir** + heure (tap sur la ligne si ON).
- Copy V1 : *« Un mot ? Un souvenir à garder aujourd'hui ? »*
- Timezone : détectée sur l’appareil, sync silencieuse.

## Déployer

```bash
# 1. Migration
supabase db push

# 2. Secrets (Dashboard ou CLI)
supabase secrets set PUSH_CRON_SECRET='…'   # ou réutiliser INACTIVITY_CRON_SECRET
# Optionnel mais recommandé (expo.dev → Access tokens) :
supabase secrets set EXPO_ACCESS_TOKEN='…'

# 3. Edge Functions
supabase functions deploy send-expo-push
supabase functions deploy daily-capture-reminder
```

## Cron — **branché en prod** (mode test = chaque minute)

- Job actuel : `daily-capture-reminder-1m` → `* * * * *` (match HH:mm exact, y compris `00:00`)
- UI test : saisie libre `HH:mm` (Espace parent → Application → Heure du rappel)
- Auth : Vault `push_cron_secret` = Edge secret `PUSH_CRON_SECRET`

Vérifier :

```sql
select jobid, jobname, schedule, active from cron.job
where jobname like 'daily-capture-reminder%';
```

Curl smoke (secret Edge `PUSH_CRON_SECRET`) :

```bash
curl -X POST "$SUPABASE_URL/functions/v1/daily-capture-reminder" \
  -H "Authorization: Bearer $PUSH_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Smoke TF

1. Activer notifications iOS (Application).
2. Activer **Rappel du soir** (défaut **20:45**), ou choisir une heure proche pour le smoke.
3. Vérifier ligne `notification_prefs` + `push_tokens` pour ton `user_id`.
4. Forcer le job (ignore l’heure) :

```bash
curl -X POST "$SUPABASE_URL/functions/v1/daily-capture-reminder" \
  -H "Authorization: Bearer $PUSH_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"forceUserId":"<TON_USER_UUID>"}'
```

5. Écran verrouillé → bandeau attendu. Anti-doublon : 1× / jour local (`push_send_log`).

## Test envoi manuel (1 compte)

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-expo-push" \
  -H "Authorization: Bearer $PUSH_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "userIds": ["<TON_USER_UUID>"],
    "title": "Petit Cœur",
    "body": "Un mot ? Un souvenir à garder aujourd'\''hui ?",
    "data": { "screen": "/(tabs)", "kind": "capture_reminder" }
  }'
```
