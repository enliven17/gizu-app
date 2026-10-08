# Apple passkey association on gizu.io

The frontend publishes `public/.well-known/apple-app-site-association` unchanged
at `/.well-known/apple-app-site-association`. It authorizes the Gizu development
iOS app (`588X2UZY3L.com.example.gizu.dev`) and the TestFlight app
(`588X2UZY3L.io.gizo.ios`) to use passkeys for `gizu.io`.
The TestFlight bundle identifier is `io.gizo.ios`, not `io.gizu.ios`.
This file does not implement web passkey login.

## Deploy on Render

Deploy the frontend from `main` using the existing build and publish settings.
Vite includes the file in `dist/.well-known/apple-app-site-association`.

For a Render Static Site, add this rule under **Headers** in the service dashboard:

| Path                                      | Name           | Value              |
| ----------------------------------------- | -------------- | ------------------ |
| `/.well-known/apple-app-site-association` | `Content-Type` | `application/json` |

The file must be served directly on `gizu.io` with valid HTTPS and HTTP 200.
Do not redirect this URL to `www`, a `.json` URL, or the application's index page.
If this deployment uses a Web Service instead, configure the same behavior in
its HTTP server. A file in `public/` cannot configure production HTTP headers.

After deployment, check without following redirects:

```sh
curl --fail-with-body -i https://gizu.io/.well-known/apple-app-site-association
curl --fail-with-body -i https://app-site-association.cdn-apple.com/a/v1/gizu.io
```

Confirm HTTP 200, `Content-Type: application/json`, and the JSON from the source
file. Apple caches domain associations, so a successful deployment may not be
immediately reflected in passkey requests. The native app must also be correctly
signed and declare `webcredentials:gizu.io` in its Associated Domains entitlement.
Check that Apple's cached JSON includes the TestFlight identity before treating
the domain fix as verified for iPhone testing. Building a new IPA does not refresh
Apple's cache.

Preserve existing app entries when adding future app IDs. Update this public file
deliberately when the accepted mobile identity changes.

References: [Render headers](https://render.com/docs/static-site-headers),
[Apple associated domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains).

## Android local development association

`public/.well-known/assetlinks.json` contains the package and public certificate
fingerprint for the local Android development build. Deploy it alongside the
Apple file at `https://gizu.io/.well-known/assetlinks.json`, returning HTTP 200 and
`application/json` without redirects. Add a matching Render header rule for this
path if needed. Preserve both files and any future approved signing identities.

Only the public fingerprint is published; the private keystore stays on the
developer's Mac. This does not configure Play production signing. Android native stored-wallet
passkeys require the installed APK certificate to appear in this association. See `docs/app-guide/ANDROID_SIGNING.md` in the repo.

The September 30 local APK update preserves the existing fingerprint and adds:

`9B:24:1F:AD:F5:9F:6B:D0:70:7B:92:88:59:46:8C:63:C6:9B:3E:CB:9B:10:60:FB:5A:2B:3A:4F:4B:C2:1C:67`

This is the public certificate verified from the rebuilt `com.example.gizu.dev` APK.
The source update is prepared; publishing it on `gizu.io` remains a deployment step.

## Production Android package

The configured Android package is **`io.gizu.android`**. The association file
includes this package with the existing local development certificates and keeps
`com.example.gizu.dev` for older installations. Deploy this change to `gizu.io`
before testing the renamed app. Verify the production APK certificate and add it
to the `io.gizu.android` statement before distributing a release signed with a
different key. For Google Play, use the Play app-signing certificate, not the upload
certificate. Registration or a config change alone does not verify release signing.

Production EAS certificate reported for `io.gizu.android` on October 2, 2026:

```text
42:09:4C:36:22:7B:49:2C:DA:6D:52:83:65:7E:87:99:41:DD:22:7C:1F:05:AF:9E:5A:5D:E1:31:73:51:49:08
```

This fingerprint is included in the source association. Deployment and verification
against the distributed APK remain required; Play app signing may use a different key.
