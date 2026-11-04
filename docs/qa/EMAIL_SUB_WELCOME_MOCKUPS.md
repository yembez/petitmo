# Maquettes — e-mails bienvenue

## Compte gratuit — `account.welcome` (ship)

> Déclencheur : auth réelle (signup / login) → Edge `send-welcome-email` · dédupe `lifecycle_email_log` (`dedupe_key=once`) · skip si compte > 72 h.  
> Sujet : **Bienvenue** · CTA : **Plus d’infos** → `https://petitcoeur.app` · salutation : prénom si dispo, sinon `Bonjour,`.  
> Légal simple : Confidentialité + mailto désinscription support.

- Template HTML prod : `supabase/functions/_shared/welcomeEmailContent.ts`
- Mockup navigateur : [`email-mockups-sub-welcome/welcome-free.html`](./email-mockups-sub-welcome/welcome-free.html)
- Photo site : `website_dev_3/public/emails/welcome-lettre-intime.jpg` (à déployer avec le site)

```bash
cd docs/qa/email-mockups-sub-welcome && python3 -m http.server 8767
# puis http://127.0.0.1:8767/welcome-free.html
```

---

## Abonnement — `sub.welcome` (maquettes abo)

> Déclencheur cible : `INITIAL_PURCHASE` RevenueCat · **PRODUCTION only** (pas Sandbox / TF).  
> Complète le modal in-app (`paywall.welcome`) ; ne remplace pas le reçu Apple.

**Maquettes HTML (design réel, ouvrables dans le navigateur)**  
Dossier : [`email-mockups-sub-welcome/`](./email-mockups-sub-welcome/)

```bash
cd docs/qa/email-mockups-sub-welcome && python3 -m http.server 8765
# puis http://127.0.0.1:8765/index.html
```

| Fichier | Design |
|---------|--------|
| `welcome-free.html` | Lettre intime gratuit (prod) |
| `A-minimal.html` | Texte simple Resend |
| `B-carte-douce.html` | Hero corail + checklist + CTA |
| `C-recap.html` | Badge Confirmé + tableau offre/prix |
| `index.html` | Comparaison côte à côte |

---

## A — Minimal (aligné mails lifecycle actuels)

**Recommandé pour ship rapide** — même ton que `sub.reactivated` / Resend actuel.

**Objet :** `Petit Cœur — bienvenue, ton abonnement est actif`

```text
Bonjour,

Merci ! Ton abonnement Petit Cœur est bien actif.

Tu peux désormais capturer jusqu’à 5 000 souvenirs, profiter du HD cloud,
et de −10 % sur les livres « vivants ».

Le paiement et le renouvellement sont gérés par Apple.
Pour gérer ou résilier : Réglages iPhone → [ton nom] → Abonnements.

À tout de suite dans l’app.
— L’équipe Petit Cœur
```

**Pros :** cohérent, deliverability, 1 journée.  
**Cons :** peu « wow ».

---

## B — Carte douce (proche modal Bienvenue)

**Objet :** `Bienvenue dans ta douce histoire — Petit Cœur`

```text
Félicitations — ton abonnement Petit Cœur est actif.

Bienvenue dans ta douce histoire.
Tu pourras capturer, garder et consulter chaque souvenir qui la raconte.

Avec ton abonnement :
• Jusqu’à 5 000 souvenirs
• Photos HD dans le cloud
• −10 % sur les livres « vivants »

Ouvre l’app pour continuer.

Paiement & renouvellement : App Store.
Résiliation : Réglages iPhone → Abonnements.
```

**Pros :** aligné copy modal in-app ; émotion.  
**Cons :** un peu plus de HTML (header corail).

---

## C — Récap abonnement (style confirmation)

**Objet :** `Petit Cœur — abonnement confirmé (annuel)`

```text
Abonnement confirmé

Offre : Annuel
Prix : 49,99 € / an (prix App Store)
Renouvellement : automatique via Apple

Ton abonnement Petit Cœur est actif. Merci de nous faire confiance
pour préserver vos moments.

Gérer l’abonnement : Réglages iPhone → Abonnements.
Confidentialité · Conditions — petitcoeur.app
```

**Pros :** rassurant (surtout 49,99 €) ; clair juridiquement.  
**Cons :** prix / durée à interpoler depuis le webhook RC (produit mensuel vs annuel).

---

## Décision produit (à cocher)

- [ ] **A** Minimal  
- [ ] **B** Carte douce  
- [ ] **C** Récap (+ vars produit / prix)  
- [ ] Hybride : **B** émotion + ligne récap plan (annuel / mensuel) sans prix forcé

**Note TF :** en Sandbox, toujours **pas** de mail (comme aujourd’hui) — Apple envoie parfois son propre reçu test.
