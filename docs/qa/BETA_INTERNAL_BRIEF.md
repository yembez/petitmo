# Brief bêta interne Petitmo (2–3 proches)

**Build** : TestFlight `1.0.0 (24)` · channel `production` · runtime `1.0.0`  
**Date** : 2026-09-24

## Message aux testeurs (copier-coller)

Salut ! Merci de tester **Petitmo** en privé (TestFlight).

1. Crée un **compte** (Google / Apple / e-mail), puis le profil de ton enfant.  
2. Capture 3+ souvenirs (photo, texte, audio si tu peux).  
3. Favoris → livre → commande impression si tu veux aller jusqu’au bout.

**Important — livre imprimé** : pendant cette bêta interne, **aucun débit carte**. Le parcours paiement est en mode « offert » (Gelato en *draft*, pas d’envoi colis réel). Tu peux aller jusqu’à la confirmation sans être facturée.

**Petitmo+** (abonnement) : pas encore à tester sur cette vague — reste sur le plan gratuit (50 souvenirs).

Bug / doute → dans l’app : **Espace parent → Signaler un problème** (ça m’envoie le contexte technique). Ou réponds à ce message.

Merci 💛

---

## Politique print (Phase 7 — figée)

- **Bêta interne** : livres **offerts** via `STRIPE_PRINT_BYPASS=1` (Edge `print-payment`) + Gelato `draft`.  
- **Pas de Stripe Checkout** pour les 2–3 proches.  
- **Avant GO ouverte** : retirer le bypass **ou** documenter clairement « livres offerts » aux 5–15 ; brancher Stripe réel si encaissement.

## Ce qu’on ne teste pas encore

- Achat Petitmo+ (IAP / RevenueCat) — Phase 9  
- Colis Gelato réel (`GELATO_ORDER_TYPE=order`) — après GO interne  
- Polish UI (press fil, immersif, etc.)
