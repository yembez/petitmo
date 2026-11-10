# Maquettes — e-mails bienvenue

## Template partagé — « communication client »

Source de vérité HTML : [`supabase/functions/_shared/clientCommunicationEmail.ts`](../../supabase/functions/_shared/clientCommunicationEmail.ts)

- Carte **blanche** (plus de crème)
- Brand Petit Cœur · titre optionnel · corps · photo · tip rose + CTA · footer
- **Responsive** : ~mobile étroit → 640px tablette → 720px desktop (`max-width` + media queries)

Utilisé par :

| Id | Contenu | Fichier |
|----|---------|---------|
| `account.welcome` | Bienvenue compte gratuit | `welcomeEmailContent.ts` |
| `sub.welcome` | Bienvenue abonnement | `subWelcomeEmailContent.ts` |

---

## Compte gratuit — `account.welcome` (ship)

> Déclencheur : auth réelle → Edge `send-welcome-email` · dédupe `once` · skip si compte > 72 h.  
> Sujet : **Bienvenue** · CTA : **Plus d’infos** → `https://petitcoeur.app`

- Mockup : [`email-mockups-sub-welcome/welcome-free.html`](./email-mockups-sub-welcome/welcome-free.html)
- Photo défaut : `https://petitcoeur.app/emails/welcome-lettre-intime-v2.jpg`  
  Override secret : `WELCOME_EMAIL_PHOTO_URL`

---

## Abonnement — `sub.welcome` (ship)

> Déclencheur : RevenueCat `INITIAL_PURCHASE` · **PRODUCTION only** (pas Sandbox / TF).  
> Dédupe `once` · ne remplace pas le reçu Apple ni le modal in-app.

- **Objet :** Bienvenue dans votre histoire  
- **Titre corps :** En route pour la plus belle de toutes les histoires : la vôtre  
- Mockup : [`email-mockups-sub-welcome/welcome-paid.html`](./email-mockups-sub-welcome/welcome-paid.html)
- Photo défaut : `https://petitcoeur.app/emails/welcome-paid-chambers.jpg`  
  (fichier local à déployer : `email-mockups-sub-welcome/welcome-paid-photo.jpg`)  
  Override secret : `SUB_WELCOME_EMAIL_PHOTO_URL`

Re-subscribe (RENEWAL / UNCANCELLATION depuis free) → toujours `sub.reactivated` (pas `sub.welcome`).

```bash
cd docs/qa/email-mockups-sub-welcome && python3 -m http.server 8767
# http://127.0.0.1:8767/welcome-free.html
# http://127.0.0.1:8767/welcome-paid.html
```

---

## Anciennes variantes A / B / C

Conservées dans le dossier pour archive (`A-minimal.html`, `B-carte-douce.html`, `C-recap.html`) — **non ship**.
