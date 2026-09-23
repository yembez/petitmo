# Domaine public Petit Cœur — `petitcoeur.app`

Le Bundle ID store reste **`com.petitmo.app`** (ne pas renommer).  
Le domaine **utilisateur** (site, e-mails, QR, CGV) est **`petitcoeur.app`**.

## Déjà basculé dans le code app

- Liens auth / Espace parent : `https://petitcoeur.app/{privacy,terms,legal}`
- CGV print : `lib/printOrderLegal.ts`
- Fallback QR : `https://petitcoeur.app/m` (`lib/publicMediaBaseUrl.ts`)
- Support Edge : destinataire `support@petitcoeur.app`, expéditeur `contact@petitcoeur.app`
- Message erreur delete-account client → `support@petitcoeur.app`
- Mails lifecycle : FROM `contact@` · aide → `support@`

Les deux adresses (`contact@` + `support@`) sont routées vers la boîte fondateur.

## Ops à faire (toi)

### 1. Resend / boîtes
1. Ajouter / vérifier le domaine **`petitcoeur.app`** (SPF, DKIM)
2. Créer / router **`contact@petitcoeur.app`** et **`support@petitcoeur.app`** (même inbox OK)
3. Autoriser l’envoi Resend depuis `contact@` (FROM brand)

### 2. Supabase Auth SMTP
[SMTP Settings](https://supabase.com/dashboard/project/gswtsnhmwjwhwjdiijbs/auth/smtp) :

| Champ | Valeur |
|--------|--------|
| Sender email | `contact@petitcoeur.app` |
| Sender name | `Petit Cœur` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | clé API Resend |

Site URL Auth → `https://petitcoeur.app` (Redirect URLs : garder `petitmo://auth`).

### 3. Landing / pages légales
Publier sur `petitcoeur.app` : `/`, `/privacy`, `/terms`, `/legal` (pages légales path-based ; SPA rewrite Vercel).

### 4. QR livres `/m`
Pointer `petitcoeur.app/m` → même backend que aujourd’hui (Railway `/m`), puis passer  
`EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL=https://petitcoeur.app/m` dans `.env` + `eas.json`.

### 5. Redeploy Edge
```bash
supabase functions deploy support-contact --project-ref gswtsnhmwjwhwjdiijbs
```

### Ne pas changer (pour l’instant)
- Bundle ID / package `com.petitmo.app`
- Scheme deep link `petitmo://`
- E-mails techniques `@petitmo.local` (device-user)
