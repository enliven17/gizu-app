# Run mobile locally

Run a native development build on macOS. Commands below start at the repository
root. The app can use mainnet funds; launching a development build does not make
transactions simulated.

## Prerequisites

- Node and npm versions required by [mobile/package.json](../../mobile/package.json).
- Rust and platform targets from [native build instructions](../../mobile/modules/gizu-stored-signer/README.md).
- iOS: Xcode, an installed simulator runtime and CocoaPods.
- Android: Android Studio SDK, platform tools and JDK 17; configure `ANDROID_HOME`
  and `JAVA_HOME`. A physical phone must be unlocked with USB debugging authorized.
- Android local builds: [development signing configured](ANDROID_SIGNING.md).

## Steps

1. Install dependencies:

   ```sh
   npm --prefix mobile ci
   ```

2. Choose the backend in `mobile/.env` using `EXPO_PUBLIC_API_URL`.
   Use `https://gizu-app.onrender.com` for the hosted backend. Never put provider
   API keys in mobile environment variables.
3. Build and install for **one** platform:

   **iOS simulator:**

   ```sh
   npm --prefix mobile run stored-signer:build:ios
   npm --prefix mobile run ios -- --no-bundler
   ```

   **Connected Android phone:**

   ```sh
   adb devices
   npm --prefix mobile run stored-signer:build -- android
   npm --prefix mobile run android -- --device --no-bundler
   ```

4. Start Metro, the development server:

   ```sh
   npm --prefix mobile start
   ```

   For Android over USB without shared Wi-Fi, use these commands instead:

   ```sh
   adb reverse tcp:8081 tcp:8081
   npm --prefix mobile start -- --localhost
   ```

   Keep the terminal running. If several devices are attached, select the intended
   one with `adb -s DEVICE_SERIAL` for the reverse command.

## Expected result

The installed Gizu development app opens and loads from Metro. JavaScript changes
reload without a native rebuild. Native-code changes require rebuilding; Expo config
or plugin changes may also require regenerating the native project.

## Troubleshooting

See [local development diagnostics](../internal/PASSKEY_TROUBLESHOOTING.md#local-development)
and the [mobile README](../../mobile/README.md) for deeper build instructions.
Simulator launch is not proof that a physical device's passkey provider works.
Expo reference: [development builds](https://docs.expo.dev/develop/development-builds/introduction/).

## Standalone Android app with Render

A release APK contains its JavaScript bundle. After installing it, tap **Gizu** in
Android's app list; USB, the laptop and Metro are unnecessary. Internet and a
compatible deployed Render backend are still required. Rebuild for new source or
environment changes; this installation does not pull a Git branch automatically.

Use the existing generated Android project and verified signing identity. Do not
uninstall Gizu, clear its storage, run prebuild or regenerate its keystore just to
update it. From `mobile/android`, with Node 24 on PATH, JDK 17 and the Android SDK:

```sh
NODE_ENV=production GIZU_BUILD_VARIANT=production \
EXPO_PUBLIC_API_URL=https://gizu-app.onrender.com \
EXPO_PUBLIC_PASSKEY_MODE=native \
./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.example.gizu.dev/io.gizu.android.MainActivity
```

This checkout's existing test phone uses that package/activity and the preserved
`mobile/.credentials/android-debug.keystore`. Verify the certificate before updating
an existing install; a signing mismatch is not a reason to erase the wallet.
The release native endpoint is pinned to Render. The USB backend property applies
only to debug builds. A standalone release can coexist with Metro running, but it
does not load code from Metro. If the backend has not deployed the new confidential
preview routes, review remains unavailable before any funds move.
