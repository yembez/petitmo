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

## Cron (toutes les 15 min) — **branché en prod**

- Job `cron.job` : `daily-capture-reminder-15m` → `*/15 * * * *`
- Migration : `20261011220000_schedule_daily_capture_reminder_cron.sql`
- Auth : Vault `push_cron_secret` = Edge secret `PUSH_CRON_SECRET`  
  (prioritaire sur `REVENUECAT_WEBHOOK_SECRET` pour les curls)

Vérifier :

```sql
select jobid, jobname, schedule, active from cron.job
where jobname = 'daily-capture-reminder-15m';
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
2. Activer **Rappel du soir**, choisir une heure dans les **15 prochaines minutes** (ex. 20:00 si il est 19:50).
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
