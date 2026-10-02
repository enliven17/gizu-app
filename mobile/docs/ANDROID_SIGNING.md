# Local Android passkey signing

The Android app package is `io.gizu.android` for all build profiles. This page
describes local development signing; release signing uses a separate production key. The former Android Mera probe is retired. Its signing configuration is retained
for the implemented native signer; see [the retirement record](NATIVE_SIGNER.md#retired-javascript-probe).

## This Mac

OpenJDK 17 is installed with Homebrew. For Android commands in a new terminal:

```sh
export JAVA_HOME="$(brew --prefix openjdk@17)/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
```

The unique local key is `mobile/.credentials/android-debug.keystore` (relative to
the repository root). It is ignored by Git and protected with owner-only file
permissions. It uses the standard development alias `androiddebugkey` and debug
password `android`; file access protects this development-only key. Never upload
or commit it, or use it for a production release.

The Expo plugin `plugins/withAndroidDevelopmentSigning.cjs` configures the generated
Gradle debug signing configuration to use this persistent key, outside `android/`.
Prebuild must not regenerate or replace it. Keep it when cleaning native folders.
Another checkout or machine needs its own deliberate signing setup; there is no
fallback to Expo's shared template debug key. EAS/Play signing is not configured here.

From `mobile/`, inspect its public fingerprint:

```sh
keytool -list -v -keystore .credentials/android-debug.keystore \
  -alias androiddebugkey -storepass android
```

Compare SHA-256 with `androidSha256Fingerprints` in `src/config/passkey-identity.json`
and the frontend's `public/.well-known/assetlinks.json`. If the key is lost or replaced,
update the public association deliberately before testing the new build.

## Deploy and verify

Deploy the frontend file at `https://gizu.io/.well-known/assetlinks.json`. It must
return HTTP 200, `application/json`, and no redirects. Preserve the Apple file.
The statements include the two relations recommended in Android's Credential
Manager prerequisites. No HTTP deep-link intent filters were added to the app.

```sh
curl --fail-with-body -i https://gizu.io/.well-known/assetlinks.json
```

An APK build and a provider test are still required to confirm the certificate
actually used by the installed app. Production requires verification of the APK signing certificate for `io.gizu.android`; for Play-distributed builds use the **Play app signing**
certificate, not merely the upload certificate.

Reference: https://developer.android.com/identity/credential-manager/prerequisites

## Run with the native signer

`npm start` opens the normal app using the stored-wallet signer. Native access is
the only supported passkey mode; simulated access and the old PRF probe are
disconnected. See [the signer guide](NATIVE_SIGNER.md) for the trust boundary.

Rebuild installed Android clients with `npm run android` after native module
changes. Metro reload alone cannot remove a bridge embedded in an older APK.

## Package identity change

`io.gizu.android` replaces `com.example.gizu.dev`. Register `io.gizu.android`
with friendly name **Gizu** in Android developer verification. This is a new
Android app identity; it does not update the old installation or copy its private
wallet storage. Keep the old installation until any required wallet recovery has
been verified.

After changing identity, regenerate the ignored Android project with
`npx expo prebuild --platform android --clean --no-install` before local builds.
The persistent `.credentials/` directory is outside that generated project.

The website association retains the old package for existing installations and
adds the new package with the known local signing certificates. Deploy that file
before passkey testing. These local certificates do not establish production
signing: inspect the actual distributed APK, add its public SHA-256 certificate
to the new package statement, and deploy again if it differs.

Production EAS certificate reported for `io.gizu.android` on October 2, 2026:

```text
42:09:4C:36:22:7B:49:2C:DA:6D:52:83:65:7E:87:99:41:DD:22:7C:1F:05:AF:9E:5A:5D:E1:31:73:51:49:08
```

This fingerprint is included in the source association. Deployment and verification
against the distributed APK remain required; Play app signing may use a different key.
