# E-mails Auth Supabase — templates FR Petit Cœur

Domaine d’envoi cible : **`petitcoeur.app`** (voir [`DOMAIN_PETITCOEUR_APP.md`](./DOMAIN_PETITCOEUR_APP.md)).  
Les e-mails par défaut (`mail.app.supabase.io`) sont limités (~2/h) — brancher **Resend SMTP**.

**App signup** : écran OTP 6 chiffres (`app/auth-verify-otp.tsx` + `verifySignupEmailOtp`).  
Le template **Confirm signup** doit donc contenir **`{{ .Token }}`**, pas seulement un lien.

## Templates

### Confirm signup — sujet

```text
Confirme ton e-mail Petit Cœur
```

### Confirm signup — corps (OTP — aligné app)

```html
<h2>Confirme ton e-mail Petit Cœur</h2>
<p>Bienvenue ! Pour sécuriser tes souvenirs, entre ce code dans l’application :</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">{{ .Token }}</p>
<p>Ce code expire bientôt. Si tu n’as pas créé de compte Petit Cœur, ignore cet e-mail.</p>
```

Fichier repo : `supabase/templates/confirmation.html` (poussé en prod via Management API).

**Sujet prod** : `Petit Cœur — ton code de confirmation`  
**Corps** : code `{{ .Token }}` en grand + rappel « pas de lien, uniquement le code dans l’app ».  
Si tu reçois un e-mail avec seulement un lien : c’est un **ancien** envoi — supprimer le compte, recréer, ignorer les mails datés d’avant le patch.

### Reset password — sujet

```text
Réinitialise ton mot de passe Petit Cœur
```

### Reset password — corps (lien deep link OK)

```html
<h2>Réinitialiser ton mot de passe</h2>
<p>Tu as demandé à changer le mot de passe de ton espace Petit Cœur.</p>
<p><a href="{{ .ConfirmationURL }}">Choisir un nouveau mot de passe</a></p>
<p>Si tu n’es pas à l’origine de cette demande, tu peux ignorer cet e-mail.</p>
```

### Magic link — sujet

`Ton lien de connexion Petit Cœur`

---

## Redirect URL (éviter la page blanche / « Lien incomplet »)

L’app envoie `redirectTo: petitmo://auth` (scheme natif — **pas** `exp://`).  
Allow-list Supabase (**URL Configuration**) :
- `petitmo://auth`
- `petitmo://**`

Site URL : `https://petitcoeur.app` (ne doit **pas** être l’unique destination du reset).

Si `petitmo://auth` n’est pas allow-listé → Safari reste sur l’ancienne page Site URL.  
Si l’app s’ouvre avec « Lien incomplet » → tokens `#access_token=…` stripés (Expo) : corrigé via `app/+native-intent.ts` (`#` → `?`).

Après tout correctif dashboard ou build : **redemander** un e-mail (ignorer les anciens liens / codes).

---

## SMTP Resend

| Champ | Valeur |
|--------|--------|
| Sender email | `contact@petitcoeur.app` (support utilisateur : `support@petitcoeur.app`) |
| Sender name | `Petit Cœur` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | clé API Resend (`re_…`) |

Dashboard : [SMTP Settings](https://supabase.com/dashboard/project/gswtsnhmwjwhwjdiijbs/auth/smtp)
