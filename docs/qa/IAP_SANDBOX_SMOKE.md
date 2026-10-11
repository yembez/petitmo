# Petitmo+ — mise en place + smoke Sandbox (Phase 9)

Règle d’or : abo **uniquement** StoreKit / RevenueCat (pas Stripe).

## IDs figés (code)

| Rôle | Valeur |
|------|--------|
| Bundle iOS | `com.petitmo.app` (vérifier ASC) |
| Produit mensuel | `petitmo_plus_monthly` |
| Produit annuel | `petitmo_plus_yearly` |
| Entitlement RC | `petitmo_plus` (`EXPO_PUBLIC_RC_ENTITLEMENT_ID`) |
| App user RC | = `auth.users.id` Supabase (`Purchases.logIn`) |
| Webhook | `https://gswtsnhmwjwhwjdiijbs.supabase.co/functions/v1/revenuecat-webhook` |
| Auth webhook | header Authorization Bearer = secret Supabase `REVENUECAT_WEBHOOK_SECRET` |

Prix produit cibles (ASC) : **5,99 € / mois**, **49,99 € / an** (affichage paywall = prix StoreKit localisés).

---

## 0) Prérequis Apple (bloquant)

- [ ] [App Store Connect](https://appstoreconnect.apple.com) → Agreements, Tax, and Banking  
      → **Paid Applications Agreement** actif + banking + tax filled  
- [ ] App iOS existe, bundle id = celui du build TF  
- [ ] Au moins un build TF installé sur iPhone physique  

Sans Paid Apps Agreement, les produits abo restent **Missing Metadata** / non achetables.

---

## 1) App Store Connect — créer les abonnements

1. App → **Subscriptions** (ou Features → In-App Purchases)  
2. Créer un **Subscription Group** ex. `Petitmo Plus`  
3. Ajouter 2 auto-renewables :

| Product ID | Référence | Durée | Prix (FR) |
|------------|-----------|-------|-----------|
| `petitmo_plus_monthly` | Petitmo+ Mensuel | 1 month | 5,99 € |
| `petitmo_plus_yearly` | Petitmo+ Annuel | 1 year | 49,99 € |

4. Pour chaque produit : localisation FR (nom + description), screenshot review si demandé, **Ready to Submit** / Clearing for Sale.  
5. (Optionnel review) lier les IAP à une version app — pour **Sandbox / TF**, Ready to Submit suffit souvent une fois le groupe créé.

---

## 2) RevenueCat — projet iOS

1. [RevenueCat](https://app.revenuecat.com) → projet Petitmo / Petit Cœur  
2. **Apps** → iOS → bundle `com.petitmo.app`  
3. Coller **In-App Purchase Key** / Shared Secret selon l’UI RC actuelle (App Store Connect API key recommandée)  
4. **Products** → importer / créer `petitmo_plus_monthly` + `petitmo_plus_yearly` (mêmes IDs qu’ASC)  
5. **Entitlements** → créer `petitmo_plus` → attacher les 2 produits  
6. **Offerings** → offering **current** (souvent `default`) avec 2 packages :  
   - Monthly → `petitmo_plus_monthly`  
   - Annual → `petitmo_plus_yearly`  
7. **Integrations → Webhooks** → Add :  
   - URL : `https://gswtsnhmwjwhwjdiijbs.supabase.co/functions/v1/revenuecat-webhook`  
   - Authorization : `Bearer <REVENUECAT_WEBHOOK_SECRET>`  
     (même valeur que secret Edge Supabase — Dashboard Functions → Secrets)  
   - Events : au minimum `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `REFUND`, `UNCANCELLATION`, `PRODUCT_CHANGE`  

### Clé API app (EAS)

- RevenueCat → API keys → **Public app-specific key** iOS (`appl_…`)  
- EAS **production** : `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` = cette clé  
- EAS : `EXPO_PUBLIC_RC_ENTITLEMENT_ID` = `petitmo_plus` (si pas déjà)  
- **Rebuild TF** si la clé change (variable embarquée au build ; OTA seule ne suffit pas toujours selon config EAS Update)

Vérifier côté machine :

```bash
npx eas env:list --environment production | rg -i 'REVENUE|RC_ENTITLEMENT'
```

---

## 3) Compte Sandbox Apple

1. App Store Connect → Users and Access → **Sandbox** → Testers → créer un compte (ex. `sandbox+petitmo@…`)  
2. Sur l’iPhone de test :  
   - iOS 18+ : **Réglages → Developer → Sandbox Apple Account** (ou se connecter au prompt d’achat)  
   - **Ne pas** rester connecté App Store prod avec le même flux si conflit  
3. TF : installer le build **production** channel  

---

## 4) Smoke achat (30 min)

1. Ouvrir l’app **connectée** (compte Supabase réel — note l’UUID Auth)  
2. Espace parent → **S’abonner** / paywall  
3. Vérifier prix localisés (pas « — » / erreur offerings)  
4. Acheter **mensuel** ou **annuel** → sheet Apple **Sandbox** → confirmer  
5. Attendu immédiat app : tier UX `paid` (écouteur RC)  
6. Attendu &lt; 1–2 min serveur :  
   - RevenueCat Customer : entitlement `petitmo_plus` **active**  
   - Supabase → Authentication → user → `app_metadata.subscriptionTier` = `"paid"`  
7. Espace parent : plan / CTA abonnement cohérent  
8. (Bonus) commande livre : remise **−10 %** visible  

### SQL / check rapide (service role)

```sql
select id, email, raw_app_meta_data->>'subscriptionTier' as tier
from auth.users
where id = '<SUPABASE_USER_UUID>';
```

### Si webhook KO

- RC → Webhooks → delivery logs (status / body)  
- Edge logs `revenuecat-webhook`  
- Auth Bearer doit matcher `REVENUECAT_WEBHOOK_SECRET`  
- `app_user_id` doit être l’UUID Supabase (pas seulement `$RCAnonymousID:…`) → vérifier que `logIn` a bien tourné après auth  

### Restore

Paywall → Restaurer les achats → même entitlement / tier.

### Expiration sandbox (optionnel)

Les renouvellements sandbox sont accélérés. Après expiration RC envoie `EXPIRATION` → Edge remet `subscriptionTier=free`.

---

## 5) Checklist GO

- [ ] Paid Apps Agreement OK  
- [ ] 2 produits ASC Ready  
- [ ] Offering RC current + entitlement `petitmo_plus`  
- [ ] Webhook 2xx sur `INITIAL_PURCHASE`  
- [ ] Achat sandbox → `subscriptionTier=paid`  
- [ ] Restore OK  
- [ ] Remise print −10 % (compte paid)  

Réf. courte : [`IAP_PETITMO_PLUS_READINESS.md`](./IAP_PETITMO_PLUS_READINESS.md) · smoke TF Phase 9 : [`BETA_TF_SMOKE_CHECKLIST.md`](./BETA_TF_SMOKE_CHECKLIST.md).
