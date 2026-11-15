# Auto Budget for Android (React Native)

Auto Budget is live as a web app (see `SPEC.md`). This document adds a **native Android app built with React Native and Expo**, published on Google Play. The web app stays live. Both apps share **one backend and one database**, so a user can sign in on either and see the same data and the same Premium status.

`SPEC.md` still defines the product: calculations, screens, copy, design tokens, special states, privacy. `SPEC-V2.md` defines Premium. This document defines how the native app is structured, how it shares the backend with the web app, and how it is built, tested and released. Where they disagree on native-specific matters, this document wins.

An iOS version is out of scope for now. Keep the code free of Android-only assumptions outside the billing and sign-in modules, so iOS can be added later.

## One backend for web and mobile

- **One Supabase project** serves both apps: the same PostgreSQL database, the same auth users, the same row-level security, the same server functions. Never create a separate project or database for mobile.
- **Same accounts.** A user who signs in with the same Google account or email on web and Android is the same user, with the same data.
- **Same tables and sync protocol.** For accounts allowed to sync (Premium, trial or legacy sync; see `SPEC-V2.md`), both apps push and pull the same tables with the same rules from `SPEC.md` (dirty flag, `updatedAt` last-write-wins, `deletedAt` soft deletes). Changes made on the phone appear on the web after sync, and the reverse.
- **Same entitlement.** Premium is stored once per user on the server. It is bought in the Android app and works in both apps.
- **Migrations live in one place** (`supabase/migrations/`) and are applied once. Both apps must tolerate columns added by a newer migration, so an older app version keeps syncing.
- **Server functions** (Supabase Edge Functions in `supabase/functions/`) are shared: account deletion, Google Play purchase verification, Google Play notifications.
- The backend stays portable to the VPS as described in `SPEC.md` ("Keeping the backend portable"); nothing in this document may tie it to a mobile-only service.

## Repository structure

Convert the existing repository into a monorepo with npm, pnpm or Yarn workspaces. Move code without changing behaviour, and keep the web app deployable at every step.

```
apps/
  web/        existing Vite + React web app (moved, unchanged behaviour)
  mobile/     new Expo (React Native) app
packages/
  core/       all calculations from src/core: pure TypeScript, with its unit tests
  data/       record types, the Repository interface, sync protocol and sync engine
  premium/    feature registry and entitlement logic (from SPEC-V2)
  config/     shared TypeScript, lint and test configuration
supabase/
  migrations/ SQL migrations for the one database
  functions/  server functions shared by both apps
```

- `packages/core`, `packages/data` and `packages/premium` must not import React, React Native, DOM, Dexie or SQLite. Each app supplies its own storage adapter.
- Moving `src/core` into `packages/core` must not change any calculation; the existing unit tests must pass unchanged.
- The web app's Vercel and Docker builds are updated for the new paths; check that the deployed web app behaves exactly as before.

## Mobile tech stack

- **Expo** with TypeScript (strict), using a **development build**, not Expo Go, because billing and native Google sign-in need native code.
- **Expo Router** for navigation, with the same screens as the web app.
- **expo-sqlite** for local storage, implementing the `Repository` interface from `packages/data` with the same record fields as the web app (`id`, `createdAt`, `updatedAt`, `deletedAt`, `dirty`).
- **@supabase/supabase-js** for auth and sync, with the session stored using Expo's secure storage, following Supabase's current React Native guide.
- **Styling:** NativeWind (Tailwind for React Native) so the design tokens from `SPEC.md` are reused. Recreate the shadcn-style components (Button, Card, Input, Switch, Slider, Sheet, Dialog, Badge, Progress) as native components with the same visual rules.
- **Icons:** `lucide-react-native`. **Fonts:** Space Grotesk and Inter bundled with the app (no network font requests).
- **Charts:** a React Native SVG-based chart library; charts follow the colour tokens and have text alternatives.
- **Billing:** a maintained React Native Google Play Billing library (for example `react-native-iap` or `expo-iap`), wrapped behind the `StoreBilling` interface described below. Check its current documentation and Google Play Billing Library version requirements before choosing.
- **Builds:** EAS Build and EAS Submit.
- Check each library's current documentation before use; do not rely on memory for APIs.

## What the Android app includes

Feature parity with the web app at the time of release: onboarding, Home, Add transaction (with the on-screen number pad), credit card breakdown with what-if, budget plan, transactions, accounts, settings, the special states, light and dark mode, backup and restore, sign-in, sync for accounts allowed to sync, and the privacy page. Follow the phone designs on the design canvas.

Native-specific behaviour:

- **Back button:** Android's back gesture closes sheets and dialogs first, then navigates back.
- **Keyboard:** amount fields use a numeric keyboard where the on-screen pad is not shown; forms avoid being covered by the keyboard.
- **Tablets:** follow the tablet layouts from `SPEC.md` (navigation rail at 600dp and wider). Do not lock orientation.
- **Dark mode:** follow the system setting by default, with the app's Appearance setting overriding it.
- **Offline:** the app is fully usable offline; sync pauses and resumes as in `SPEC.md`.
- **Backup files:** "Save a backup file" writes to Downloads; "Share a backup file" uses the Android share sheet; "Restore from a file" uses the document picker.
- **Deep links:** register a scheme (for example `autobudget://`) and the web domain's App Links so sign-in redirects return to the app.
- **App lock:** out of scope for now.

## Free backup on Android

- **Android Auto Backup:** keep Android's built-in app data backup enabled and include the SQLite database in it, so Android backs it up to the user's own Google account and restores it after a reinstall or on a new Android phone. Use backup rules (and data extraction rules for newer Android versions) to:
  - include the database file;
  - **exclude** the signed-in session and anything in encrypted or Keystore-backed storage, which cannot be restored on another device;
  - exclude caches.
- Make sure the database is in a consistent state for backup (for example, checkpoint SQLite's write-ahead log after writes).
- On first launch, if a restored database exists, skip onboarding and open Home with a notice: "Welcome back. Your data was restored by Android backup."
- Android's app backup has a size limit per app (25 MB when this was written); a text-only budget database stays far below it. If the database ever approaches it, show a notice suggesting a backup file.
- This backup happens on Android's schedule (typically daily when charging and on Wi-Fi) and depends on the user's device backup setting. The app cannot show the exact last backup time; the Backup and restore screen explains this and offers a button that opens Android's backup settings.
- No account, server or Drive API is involved, so there is no running cost and nothing for the developer to store.

## Sign-in on Android

- **Email with an 8-digit code** works the same as on the web.
- **Continue with Google** uses native Google sign-in on Android and passes the resulting ID token to Supabase (`signInWithIdToken`), following Supabase's current guide. Configure the Android OAuth client (package name and signing certificate fingerprints for both the upload key and Google Play's app signing key) and the web client ID in the same Google Cloud project.
- Add the app's redirect URLs to the Supabase project's allowed redirect list alongside the web app's.
- The first sign-in on a device with local data uploads it, and a new device downloads the account's data, exactly as on the web.

## Google Play billing (Premium)

Premium is sold **only in the Android app**, as a Google Play one-time product. The web app never sells Premium; it reads the same entitlement.

### Play Console setup

- One **one-time product** (non-consumable), product ID `premium_unlock`, named "Auto Budget Premium".
- Set the price in Play Console (Philippine peso first, with Google's local prices for other countries). The app always shows the price Google returns, never a hard-coded amount.
- Enrol the developer account in the reduced service fee tier if eligible.
- Create a Google Cloud service account with access to the Google Play Developer API for this app. Its key is a secret used only by server functions.
- Set up **Real-time developer notifications**: a Cloud Pub/Sub topic with a push subscription to the `play-notifications` server function.

### `StoreBilling` interface (in the mobile app)

`getProduct()`, `purchase(userId)`, `getOwnedPurchases()`, `onPurchaseUpdated(callback)`. Only this module imports the billing library.

### Purchase flow

1. The user must be signed in (Premium belongs to an account). Guests are sent to Sign in first, then back to the paywall.
2. The paywall loads the product with `getProduct()` and shows its localised price. If the product cannot be loaded (no Play Store, offline), show "Google Play isn't available right now" and disable the button.
3. `purchase(userId)` launches the Google Play purchase flow, passing an **obfuscated account ID** derived from the Supabase user ID (a one-way hash, never the email).
4. When the library reports a purchase, the app sends `{ productId, purchaseToken }` to the `verify-play-purchase` server function with the user's session.
5. `verify-play-purchase`:
   - checks the session;
   - asks the Google Play Developer API for the purchase by product ID and token;
   - requires that it is purchased (not pending or cancelled) and that its obfuscated account ID matches this user;
   - refuses a token already linked to a different user ("This purchase belongs to another Auto Budget account");
   - records it in `purchases` (`provider = google_play`, `provider_payment_id = purchaseToken`, unique, plus the order ID and the raw response);
   - sets the entitlement to `premium`, `source = purchase`, `expires_at = null`;
   - **acknowledges** the purchase through the API if it is not yet acknowledged (Google refunds unacknowledged purchases after three days);
   - is idempotent: repeating the call for the same token returns success without duplicating anything.
6. After a successful response, the app completes the transaction in the library **without consuming it** (it is a non-consumable), refreshes the entitlement, and shows the success state.
7. **Pending payments** (methods that complete later): show "Payment pending. Premium unlocks as soon as Google Play confirms it." Do not grant anything until the purchase is purchased; the notification or the next app open completes it.
8. Errors and cancellations return to the paywall with a clear message; nothing is granted on the client.

### Restore and other devices

- **On app open** and from a **"Restore purchase"** link on the paywall, call `getOwnedPurchases()` and send any `premium_unlock` purchase to `verify-play-purchase`. This covers reinstalls, new phones and purchases that completed while the app was closed.
- Because the entitlement is on the server, signing in on the web app or another phone unlocks Premium there too.

### Refunds and revocations

- `play-notifications` receives Real-time developer notifications, verifies the push request, and on a voided or refunded purchase marks it `refunded` and returns the entitlement to `free`.
- A daily scheduled job also checks the **Voided Purchases API** as a safety net.
- Data is never deleted when Premium is revoked (see `SPEC-V2.md`).

### Premium for testers

Testers in internal and closed testing must be able to use Premium. Support all three ways below; the owner chooses per tester.

1. **Test purchases (default for every tester).** Add each tester's Google account as a **license tester** in Play Console. They go through the real purchase flow but pay with Google's test payment methods and are never charged. This also tests the whole purchase path.
   - `verify-play-purchase` reads Google's purchase type and stores `is_test = true` on the purchase when it is a test purchase. Test purchases grant Premium exactly like real ones.
   - Use the test methods to cover approved, declined and slow (pending) payments.
2. **Tester grant (no purchase needed).** For testers who should simply have Premium from the start, the owner adds their account email to a `tester_grants` table (`email`, `expires_at` optional, `note`). When a user signs in with a matching verified email, the server sets their entitlement to `premium` with `source = grant` and the given expiry (null means until removed). Removing the row and running `revoke_tester_grants()` returns them to free. Only the service role can read or write this table.
3. **Promo codes (optional).** Play Console promo codes for `premium_unlock` let a tester redeem Premium for free through Google Play. Check Play Console's current promo code rules and quotas before relying on them.

Testers should also check the free experience: the locked views, the paywall and the trial. Ask some testers to start without a grant, try the trial first, then make a test purchase.

**At production launch** the owner decides what happens to testers' Premium:
- **Keep it (suggested, as thanks):** do nothing; test purchases and grants stay valid.
- **Remove it:** run `revoke_test_entitlements()`, which returns accounts whose only Premium source is a test purchase or a tester grant to free. Data is never deleted.

Test cases: successful purchase, cancelled purchase, declined payment, pending purchase that later completes, refund from Play Console, restore after reinstall, the same Google account signed in to two Auto Budget accounts, a tester grant applied on first sign-in, and Premium appearing on the web after buying on Android.

## Google Play release

### Before the first upload

- Choose the package name (for example `com.[yourname].autobudget`); it can never change.
- App icon, adaptive icon, splash screen, feature graphic and phone and tablet screenshots, in light mode.
- Store listing text in English, written from the design canvas copy.
- **Privacy policy URL:** the web app's `/privacy` page.
- **Account deletion:** in-app (Settings) and a **web link** where users can request deletion without the app (the web app's account page or a dedicated page), as Google Play requires for apps with accounts.
- **Data safety form:** declare what is collected when signed in (email; budget data entered by the user, only for accounts that sync; purchase history), that data is encrypted in transit, that users can request deletion, and that nothing is shared or sold. Keep it consistent with `PRIVACY.md`.
- Content rating questionnaire and target audience (adults; not directed at children).
- Target the API level Google Play currently requires for new apps; check Play Console before the first upload.

### Testing tracks

1. **Internal testing** for the developer.
2. **Closed testing**, with every tester added as a license tester (see "Premium for testers"), for new personal developer accounts: Google requires a minimum number of testers opted in continuously for a set number of days before production access (12 testers for 14 days when this spec was written; check the current requirement in Play Console). Recruit more than the minimum, since people drop out.
3. Apply for **production access**, answering Google's questions with what was learned in testing.
4. **Production** with a staged rollout.

### Builds and versions

- EAS Build produces Android App Bundles; EAS Submit uploads them to the chosen track.
- Use Play App Signing.
- JavaScript-only fixes may be shipped with EAS Update to the same native build; any native change (libraries, permissions, billing) needs a new build and store release.
- Version numbers increase with every store upload. The app checks a minimum supported version from the server and asks users to update if theirs is too old to sync safely.

## Environment and secrets

- Mobile app public config (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_PREMIUM_ENABLED`, `EXPO_PUBLIC_WEB_URL`) is the same project as the web app's `VITE_*` values.
- Secrets used only by server functions: the Supabase service-role key, the Google Play service account key, and the Pub/Sub push verification settings. They never appear in either app.

## Build order

Keep the web app deployable throughout.

1. Monorepo conversion: move the web app to `apps/web`, extract `packages/core` and `packages/data`, update builds. Verify the deployed web app is unchanged.
2. Create the Expo app with a development build, Expo Router, NativeWind tokens, fonts, and the SQLite repository.
3. Screens to parity with the web app, phone first, then tablet layouts.
4. Sign-in (email code and native Google), sync against the shared Supabase project for accounts allowed to sync, and free backup (Android Auto Backup rules and backup files). Verify a change on the phone appears on the web and the reverse for a syncing account, and that a reinstall restores data through Android backup.
5. Store listing assets, privacy URL, deletion link, Data safety form; first internal testing release; start the closed test as early as possible, because the waiting period runs while you build Premium.
6. Premium features and entitlements from `SPEC-V2.md`, shared by both apps.
7. Google Play billing: Play Console product, `StoreBilling`, `verify-play-purchase`, `play-notifications`, restore, and license-tester purchases.
8. Production access, then a staged production rollout.

## Test scenarios

- Sign in on Android and web with the same Google account with Premium: both show the same data. Without Premium, nothing syncs.
- Reinstall the app with Android backup on: data returns without signing in.
- Add a transaction offline on the phone, reconnect, and it appears on the web.
- Buy Premium on Android; sign in on the web and Premium features unlock there.
- Reinstall the app, sign in, tap Restore purchase: Premium returns without paying again.
- A refunded purchase locks Premium on both apps at their next refresh.
- An older app version keeps syncing after a new migration adds a column.
