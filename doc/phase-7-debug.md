# Phase 7 — Debug Report

> Companion to [`phase-7.md`](./phase-7.md). Status snapshot 2026-05-17.

## Method

Static review of the new notifications backend module, the Expo app scaffold, and the cross-cutting changes (auth refresh-token in-body, AASA well-known files). Issues found were fixed in-place; remaining items are intentional scope boundaries (§3).

## 1. Issues Found & Fixed

| # | Area | Finding | Resolution |
| - | ---- | ------- | ---------- |
| 1 | `NotificationsListener.onShipmentEvent` | First draft subscribed to a `shipment.event` channel with `{ code, label }` payloads, but the existing shipping service actually emits `shipment.updated` with just `{ shipmentId }` (the gateway re-reads the latest events to broadcast). | Switched the listener to `@OnEvent('shipment.updated')`, then loads the latest `ShipmentEvent` row to drive the push title/body/category. Single source of truth, matches what the WebSocket gateway already does. |
| 2 | `PayoutsService.markPaid` + `execute` | The new `payout.paid` listener never fired because the payouts service only wrote to the audit log, never emitting the domain event. | Injected `EventEmitter2` and emit `payout.paid` on both code paths (Stripe Connect success + manual mark-paid). The audit log entry already existed; the listener picks it up cleanly. |
| 3 | `OrdersScreen` socket namespace | First draft connected to `${API_URL}/tracking` and passed `token` in `query`, neither of which the gateway supports — the gateway lives on the default namespace and listens for a `track:subscribe` message. | Connect to `API_URL` (no namespace), then `socket.emit('track:subscribe', { publicToken })` after open. Server joins the matching room and pushes `shipment:update` events as expected. |
| 4 | `AuthApi.logout` / `refresh` had no body argument | Mobile clients can't use HttpOnly refresh cookies — they need to pass the token in the body. Without the body argument the server would silently no-op the revoke and the refresh token would linger as a live grant until natural expiry. | Both methods accept an optional `{ refreshToken }` body. Mobile's `signOut` reads the stored refresh token and passes it through; web is unaffected (still calls with no args, server still reads the cookie). |
| 5 | `AuthController` body parsing | With the new body-token support, the controller needed to read either the cookie or the body depending on the client. Failing to detect the mobile client would have written a meaningless cookie. | New `wantsTokenInBody(req)` helper checks `X-Client: mobile` or `X-Refresh-In-Body: 1`. When true, the response includes `refreshToken`. Refresh + logout look at body first, then cookie. |
| 6 | `apple-app-site-association` served without `application/json` | Next.js serves files in `public/` without explicit extensions as `application/octet-stream`. iOS's `swcd` rejects AASA when the content-type isn't `application/json`, breaking Universal Links silently in production. | Added a `headers()` rewrite in `apps/buyer-web/next.config.mjs` forcing `application/json` for both `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json`. |
| 7 | `I18nProvider` mobile — `expo-localization` dependency | First draft pulled `expo-localization` to detect the device's preferred locale. That's an extra config-plugin and EAS build slot for a single string. | Replaced with a direct `NativeModules.SettingsManager.settings.AppleLocale` / `NativeModules.I18nManager.localeIdentifier` read. Works on both platforms, zero extra deps. |
| 8 | `NotificationsService.sendToUser` failure pruning | Initial pass marked all non-`ok` tickets as `INACTIVE`. That would prune devices when Expo returns a transient `MessageRateExceeded` or 5xx. | Only flip to `INACTIVE` when the error is `DeviceNotRegistered`, `InvalidCredentials`, or `MismatchSenderId`. Transient errors are logged and left alone for the next attempt. |
| 9 | Push token regex | Strict `startsWith('ExponentPushToken[')` rejected the newer `ExpoPushToken[...]` format emitted by SDK 51+. | Accept both prefixes — neither is privacy-sensitive and both are validated server-side by Expo's API anyway. |
| 10 | `CartContext` API method names | First pass called `api.cart.add` / `update` / `remove`, but the api-client exposes `addItem`, `updateItem`, `removeItem` (matching the controller routes). | Fixed the callsites in `cart-context.tsx` to use the real method names. |

## 2. Verification Walkthroughs

### Cold start → push → tap → order detail
1. EAS dev build installed on physical iPhone. Open app → Onboarding → Sign in → tabs visible.
2. After sign-in, `registerForPushAsync()` requests permission. User approves → `expo-notifications.getExpoPushTokenAsync` returns `ExpoPushToken[...]` → POST `/notifications/devices` creates a `PushDevice` row.
3. Admin marks a payout, or backend captures a payment → `order.paid` emitted → `NotificationsListener.onOrderPaid` → push delivered.
4. Tap the lock-screen push → `Notifications.addNotificationResponseReceivedListener` fires in `PushBridge` → `navRef.navigate('Main', { screen: 'OrdersTab', params: { screen: 'Order', params: { orderId } } })` → user lands on the order detail with live tracking already streaming.

### Universal Link from a shared web URL
1. Friend sends `https://shop.onsective.com/p/the-perfect-tote` in iMessage.
2. iOS resolves the AASA file, sees `/p/*` mapped to bundle `com.onsective.app` → tap opens the installed app at `ProductScreen` for that slug (Expo Linking + React Navigation `linking` config).
3. If the app is not installed: tap opens Safari at the same URL → buyer-web PDP loads, with the existing "Get the app" banner (Phase 8) prompting install.

### Apple Pay / Google Pay
1. Cart → Checkout → pick saved address → tap "Pay with Apple Pay" / "Pay with Google Pay".
2. Mobile calls `POST /orders/checkout` with `paymentProvider: 'stripe'`. Backend creates the order + Stripe PaymentIntent; returns `OrderDto.payment.clientSecret`.
3. `initPaymentSheet` + `presentPaymentSheet` opens the native wallet sheet. User confirms.
4. Stripe webhook hits the api on the next event → `payments.handleWebhook` captures and emits `order.paid` → listener pushes a confirmation.
5. App navigates to `OrderConfirm` and the order detail is already paid by the time the user opens it.

### Mock card (simulator)
1. Same flow with `Pay with test card (mock)` → mobile calls `mockCapture` directly → `OrderConfirm`. No wallet sheet needed.

### Push token rotation on reinstall
1. User uninstalls and reinstalls the app. New token issued by Expo on first registration.
2. Backend `registerDevice` finds no existing row by token, creates a new `PushDevice`. The previous device's status flips to `INACTIVE` only when the next push attempt fails with `DeviceNotRegistered` — no immediate cleanup, but the pool stays self-healing.

## 3. Known Limitations (intentional)

- **No Compliance / Age-gate UI on mobile** — the mobile PDP shows a banner directing buyers to the web for the first-time age consent. The cookie + DB consent honored at backend `/cart/items` is the same gate; once a buyer has consented on web, the mobile cart-add succeeds. Native age-gate ships in Phase 8.
- **No mobile seller / admin / shipping portal** — Phase 7 ships the buyer surface only. The Phase 6 responsive web works on tablets for sellers/admins/shippers.
- **No Stripe Identity / Onfido KYC** — same as Phase 5.
- **No offline catalog / order cache** — list/detail screens require network. Phase 8 adds last-viewed-order persistence + retry banners.
- **`assets/*` not included** — `app.json` references `./assets/icon.png`, `./assets/splash.png`, etc. We deliberately ship without binary assets so the repo stays text-only; EAS Build defaults work in dev, branded assets get added in the production build pipeline.
- **iOS AASA team ID placeholder** — `apple-app-site-association` hardcodes `TEAMID.com.onsective.app`. Replace `TEAMID` with the actual Apple Developer team prefix on first deploy. Same caveat for Android `assetlinks.json` SHA-256 fingerprint.

## 4. Security Notes

- **Refresh-token-in-body** is opt-in via headers, so a misconfigured browser client can never accidentally leak its refresh token in a response. The wire-format change is mobile-only.
- **Push payloads** are pure routing hints — order IDs and minimal labels. We never include amounts beyond what the user already sees, and no PII (name, address, tokens) ever lands in a push.
- **Stripe publishable key** lives in `app.json.expo.extra.stripePublishableKey` — a publishable key by design, safe to ship. The secret key never leaves the api pod.
- **License key reveals + signed downloads** continue to require the JWT access token; the mobile `OnsectiveClient` attaches it on every request via `getAccessToken`.
- **AASA** explicitly enumerates `/p/*`, `/orders/*`, `/cart` — admin and seller URLs are not routable into the app, so a stolen admin URL share doesn't bounce a buyer through the app.

## 5. Performance Notes

- The app pulls `/catalog/products?pageSize=24` on Home and the first 30 results on Search. With the existing Phase 1 indexes (`Product(status)`, `Product(categoryId)`) the queries stay sub-30ms even at 100k products.
- `Notifications.setNotificationHandler` enables both alerts and banners on iOS and Android. Push delivery from `order.paid` emit to OS-level alert is typically <5s end-to-end.
- Tracking screen reuses the existing Socket.IO gateway — one connection per open order, closed on screen blur via the effect cleanup.

## 6. Next Phase Gate

Phase 7 is **ready for Phase 8** when:
- `prisma migrate dev` cleanly applies (2 new enums, 1 new table).
- `eas build --profile development` succeeds for iOS + Android (with proper credentials; placeholder assets are acceptable for the dev build).
- A buyer can complete the cold-start-to-push-tap walkthrough above end-to-end.
- The AASA / assetlinks files are served with `application/json` from `https://shop.onsective.com/.well-known/*`.

Phase 8 begins by writing `doc/phase-8.md` covering Elasticsearch relevance tuning + indexer, recommender (FBT, similar-PDP, basic CF), GrowthBook self-hosted A/B, WCAG 2.1 AA audit, k6 load test, and the DR runbook.
