# Build Android APK for Onsective mobile, wired to api.itsnottechy.cloud

**Date:** 2026-05-23
**Status:** Approved, ready to implement
**Owner:** Rishabh

## Goal

Produce an installable Android APK from `apps/mobile/` (Expo React Native) that talks to the production backend at `https://api.itsnottechy.cloud` (already deployed on a Hostinger VPS). Build locally with Gradle, sign with an auto-generated keystore, and switch the deep-link domain from `shop.onsective.com` to `shop.itsnottechy.cloud`.

Out of scope for this pass: iOS build, Stripe key wiring, assetlinks.json publication, Play Store upload, custom icons.

## Files changed

Only two source files change. All downstream code already reads the API URL indirectly via `Constants.expoConfig.extra.apiUrl`.

### `apps/mobile/app.json`

- `extra.apiUrl`: `https://api.onsective.com` → `https://api.itsnottechy.cloud`
- `ios.associatedDomains`: replace `applinks:shop.onsective.com` and `applinks:onsective.com` with `applinks:shop.itsnottechy.cloud`
- `android.intentFilters[0].data[0].host`: `shop.onsective.com` → `shop.itsnottechy.cloud`
- `android.intentFilters[0].data[1].host`: `shop.onsective.com` → `shop.itsnottechy.cloud`

### `apps/mobile/src/lib/linking.ts`

- `prefixes` array: replace `https://shop.onsective.com` and `https://onsective.com` with `https://shop.itsnottechy.cloud`
- Update the file-level docstring to reference the new host

## Build flow

```bash
# 0. Pre-flight: confirm backend is up
curl -sSI https://api.itsnottechy.cloud/health    # or / if no /health route

# 1. Install workspace deps from repo root
pnpm install

# 2. Generate the Android Gradle project from app.json
cd apps/mobile
npx expo prebuild --platform android --clean

# 3. One-time: create a release keystore
keytool -genkeypair -v \
  -keystore android/app/onsective-release.keystore \
  -alias onsective -keyalg RSA -keysize 2048 -validity 10000

# 4. Wire keystore into android/app/build.gradle:
#    - signingConfigs.release { storeFile, storePassword, keyAlias, keyPassword }
#    - buildTypes.release.signingConfig signingConfigs.release

# 5. Build
cd android && ./gradlew assembleRelease

# Output: apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

## Pre-flight check (gates the rest of the work)

Before any file edits, run `curl -sSI https://api.itsnottechy.cloud/health`. If it does not return 2xx (or at least a recognizable response from the NestJS app), stop and surface that to the user — building an APK that points at a dead backend is a waste of 15 minutes.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Keystore loss locks the user out of Play Store updates forever | Print loud post-build reminder with absolute path to the .keystore file and the passwords; suggest backing up to a password manager |
| First Gradle build is slow (~10–20 min) | Inform user; do not interrupt |
| `pnpm install` fails due to workspace peer deps | Diagnose root-cause before retrying; do not blindly add `--force` |
| Deep-link `autoVerify: true` fails because assetlinks.json is missing on shop.itsnottechy.cloud | Documented as a known gap; links still open via chooser UI |
| Stripe publishable key is empty in app.json `extra.stripePublishableKey` | Checkout will fail at the payment step; flagged in final report |

## Verification

After build completes:

1. APK file exists at the expected path and is non-empty.
2. `unzip -p app-release.apk AndroidManifest.xml | head` shows package `com.onsective.app`.
3. (Optional, if `adb` is in PATH) `adb install -r app-release.apk` to a connected device and confirm the home screen loads without a network error.

## Acceptance

A single APK file at `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, signed, installable on Android 7.0+, talking to `https://api.itsnottechy.cloud` on first launch.
