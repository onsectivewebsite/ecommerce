# Phase 7 — Mobile Apps

> Status: 🟡 in progress · Owner: platform · Window: 2026-05-17 → 2026-05-17

Phase 7 ships a native buyer experience on iOS and Android via a single Expo (React Native) codebase. The app consumes the same `@onsective/api-client` as the web portals, supports Apple Pay / Google Pay via the Stripe React Native bindings, registers for Expo push notifications which the backend uses to drive the order lifecycle (paid, shipped, out-for-delivery, delivered, exception), and handles `onsective://` deep links plus Apple Universal Links / Android App Links for shareable PDP and order URLs.

## 1. Goals

1. **Single Expo TypeScript codebase** at `apps/mobile`, EAS-buildable for iOS + Android. No bare workflow — Expo managed app with config plugins for Stripe and Notifications.
2. **Screens**: Onboarding (welcome + permissions) → Auth (login / register) → Home (categories + featured) → Search → PDP → Cart → Checkout (wallet pay first, mock card fallback) → Order confirmation → Orders list → Order detail → Live tracking → Account.
3. **Wallet payments**: Apple Pay on iOS and Google Pay on Android via `@stripe/stripe-react-native`. The mobile app calls a new `POST /payments/intent` API that returns a Stripe PaymentIntent client secret; existing webhook handler captures and emits `order.paid`.
4. **Push notifications**: device registration on first launch after sign-in. Backend `NotificationsModule` listens on `order.paid` / `shipment.event` / `payout.paid` and sends per-user Expo pushes via the Expo Push API. Devices that fail (`DeviceNotRegistered`) get marked inactive.
5. **Deep links**: tapping an order push opens the app directly on the order detail screen. Sharing a PDP URL opens the app (or web, if not installed) at the product. Configured via Expo Linking + iOS associated domains + Android intent filters.
6. **Self-hosted FCM proxy** (env-toggled): for buyers in markets where the Expo push service is unreliable, the backend can switch from `EXPO_PUSH_URL=https://exp.host/--/api/v2/push/send` to a self-hosted proxy that translates the same payload into FCM (Android) and APNs (iOS).

## 2. Non-goals (intentional, deferred)

- **Mobile seller / admin apps** — Phase 7 ships the buyer surface only. Sellers and admins continue to use the web portals (which are already responsive enough for tablets).
- **Native modules outside Expo's managed set** — we deliberately avoid ejecting. If something requires a bare workflow (e.g. truly custom haptics), it goes on the Phase 8 list.
- **Offline catalog** — list and detail screens require network. Local caching of the last-viewed order is the only persisted artifact.
- **WatchOS / Wear OS apps** — out of scope.
- **In-app purchase via Apple / Google IAP** — the buyer-side is shipping physical + digital goods, both of which fall outside Apple's IAP rule for marketplace goods. Wallet pay via Stripe is correct here.

## 3. Backend additions

### Schema
```
enum PushPlatform { IOS  ANDROID  WEB }
enum PushDeviceStatus { ACTIVE  INACTIVE  REVOKED }

model PushDevice {
  id            String            @id
  userId        String
  expoPushToken String            @unique
  platform      PushPlatform
  status        PushDeviceStatus  @default(ACTIVE)
  deviceModel   String?
  appVersion    String?
  lastSeenAt    DateTime          @default(now())
  createdAt     DateTime          @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, status])
}
```

### Modules
```
services/api/src/modules/notifications/
  notifications.module.ts
  notifications.service.ts          # registerDevice, sendToUser, prune
  expo-push.client.ts               # tiny fetch wrapper for the Expo push API
  notifications.listener.ts         # @OnEvent('order.paid'|'shipment.event'|'payout.paid')
  notifications.controller.ts       # POST/DELETE devices, GET /me/devices
```

### Payment intent endpoint
- `POST /payments/intent` with `{ orderId, provider: 'stripe' | 'mock' }` returns `{ clientSecret, providerRef }` after creating an Order from a cart (mobile pattern: client owns the cart, calls checkout, then the wallet sheet completes the intent and the existing webhook captures). The existing `OrdersService.checkout` already returns the clientSecret in `OrderDto.payment.clientSecret`; the new endpoint reuses that path and exposes it cleanly to the mobile flow.

## 4. Mobile app layout

```
apps/mobile/
  package.json
  app.json                            # Expo config — name, scheme, plugins, deep links
  tsconfig.json
  index.ts                            # registerRootComponent
  App.tsx                             # Provider stack: SafeArea, Stripe, Auth, Cart, I18n
  src/
    lib/
      api.ts                          # OnsectiveClient + token storage via expo-secure-store
      auth-context.tsx
      cart-context.tsx
      i18n-context.tsx                # mirrors buyer-web, uses @onsective/i18n
      env.ts
      push.ts                         # registerForPushAsync + handle interactions
      linking.ts                      # Expo Linking config
      stripe.ts                       # publishable key + apple/google merchant ids
    components/
      Button.tsx, Card.tsx, Money.tsx, Screen.tsx  # native primitives w/ dark-first theme
    screens/
      OnboardingScreen.tsx
      LoginScreen.tsx
      RegisterScreen.tsx
      HomeScreen.tsx
      SearchScreen.tsx
      ProductScreen.tsx
      CartScreen.tsx
      CheckoutScreen.tsx
      OrderConfirmScreen.tsx
      OrdersScreen.tsx
      OrderScreen.tsx                 # detail + live tracking via socket.io-client
      AccountScreen.tsx
    navigation/
      RootNavigator.tsx               # auth gate + tab/stack
      types.ts
```

## 5. Decisions log (Phase 7)

| ID | Decision | Rationale |
| -- | -------- | --------- |
| D-042 | Expo managed workflow, not bare React Native | Single binary path, no Xcode / Android Studio for day-to-day work, EAS Build for prod. Bare workflow buys us little until we need true native modules. |
| D-043 | Expo Push API (not direct FCM/APNs from the api) | We get free fan-out, device-id management, and platform-routing across iOS/Android with one HTTP call. The self-hosted FCM proxy stays as a fallback for regions where exp.host is unreliable. |
| D-044 | Reuse `@onsective/api-client` + `@onsective/i18n` | The mobile binary should share business logic with the web. Both packages have no DOM dependencies — `OnsectiveClient` is just `fetch` and the i18n catalog is JSON imports. |
| D-045 | Token storage via `expo-secure-store` | Keychain on iOS, EncryptedSharedPreferences on Android. The refresh token's HttpOnly cookie semantics don't translate to mobile, so we mirror with a secure-storage strategy and a short-TTL access token. |
| D-046 | One push category per event kind, locally scheduled actions | `order_paid`, `shipment_in_transit`, `shipment_delivered`, `payout_paid`. Categories let iOS show appropriate action buttons (Track, View order) without server-side templating. |
| D-047 | Deep link scheme `onsective://` + universal-link domain `shop.onsective.com` | Same domain as buyer-web so PDP URLs work in both worlds — the iOS associated-domains file `apple-app-site-association` is served from buyer-web at `/.well-known/`. |
| D-048 | No app-level state-management library | React context + useReducer is sufficient for the screen graph we ship. Adding Zustand / Redux for the buyer surface would be premature; we revisit if Phase 8 lists feature requests that demand it. |

## 6. Exit criteria

- `eas build --profile development --platform ios|android` produces a runnable app on a simulator and a physical device.
- A buyer can: open the app cold → onboarding → sign up → see products → add to cart → check out with Apple Pay or Google Pay (mock-card on simulator) → see order confirmation → receive a push notification on `order.paid` → tap push → land on the order detail screen with live tracking events streaming.
- Tapping a `https://shop.onsective.com/p/<slug>` URL from another app opens the installed mobile app on the matching PDP (or web if uninstalled).
- `PushDevice` rows are created on registration, marked INACTIVE on `DeviceNotRegistered` errors, and pruned after 90 days of inactivity.
- `doc/phase-7-debug.md` lists all issues found and fixed.
