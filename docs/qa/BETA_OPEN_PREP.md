# Prep GO ouverte (Phases 10–11) — à faire après GO interne + IAP

## Avant d’inviter 5–15 mamans

- [ ] Retirer `STRIPE_PRINT_BYPASS` **ou** confirmer politique « livres offerts » écrite à tout le panel
- [ ] Si encaissement : Stripe Checkout smoke bout-en-bout (vrai débit test)
- [ ] Gelato : 1 colis volontaire `GELATO_ORDER_TYPE=order` + QR OK
- [ ] Petitmo+ sandbox → `subscriptionTier=paid` (Phase 9)
- [ ] Privacy / CGV contenu juridique validé (URL déjà joignable)
- [ ] Panel 5–15 + brief mis à jour (plus de « proche seulement »)
- [ ] **Sentry HITL auto** : Internal Integration (ou Alert) → Edge `sentry-issue-notify` — smoke « nouvelle issue → mail draft support@ » (le bouton legacy « Send Test Event » ne compte pas)
- [ ] Cocher checklist GO dans [`BETA_FR_GO_NOGO.md`](./BETA_FR_GO_NOGO.md)
- [ ] Suivi `export_requests` + Sentry HITL pendant la vague

## Critères succès

- ≥ 80 % finissent onboarding + 3 souvenirs sans crash
- ≥ 1 commande print réussie hors ton téléphone
- Aucun P0 infra récurrent
