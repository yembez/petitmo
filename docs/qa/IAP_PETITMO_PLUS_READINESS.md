# Petitmo+ IAP — readiness (Phase 9)

## Code / Edge (déjà livré)

| Élément | État |
|---------|------|
| `lib/revenueCat.ts` + init silencieuse | Code |
| `Purchases.logIn(supabaseUser.id)` post-auth | Code |
| Edge `revenuecat-webhook` | ACTIVE (2026-09-23) |
| `app_metadata.subscriptionTier` | Cible serveur |
| Paywall `app/paywall.tsx` | Contexts LIMIT_REACHED / GENERAL / … |
| Remise print −10 % | `lib/pricingV1.ts` |

## Bloquants fondateur (à débloquer avant GO ouverte)

1. **Apple Developer** : Paid Applications Agreement + banking / tax.
2. **App Store Connect** : produits abo mensuel / annuel liés à l’app `com.petitmo.app`.
3. **RevenueCat** : offerings + entitlement aligné `EXPO_PUBLIC_RC_ENTITLEMENT_ID` (EAS production).
4. **Secrets EAS** : `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` (déjà listé sur EAS prod — vérifier valeur live).
5. **Smoke sandbox** : achat → webhook → `subscriptionTier=paid` → quotas / paywall.

## Hors Phase 9

- Stripe print (séparé — bypass bêta interne aujourd’hui).
- Lifecycle mails Resend (spec post-bêta).
