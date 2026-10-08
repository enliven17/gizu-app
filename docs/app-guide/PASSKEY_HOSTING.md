# Host passkey associations

Publish the files that allow Gizu's signed apps to use passkeys on `gizu.io`.
This procedure deploys the frontend, not the backend or mobile app.

## Prerequisites

- Access to the frontend hosting service and `gizu.io`.
- [Confirmed app identities](PASSKEY_CONFIGURATION.md) and
  [Android signing certificates](ANDROID_SIGNING.md).

## Steps

1. Check the source files. Preserve approved entries for existing installations:
   - [Apple association](../../frontend/public/.well-known/apple-app-site-association)
     must include `588X2UZY3L.io.gizo.ios` under `webcredentials.apps`.
   - [Android association](../../frontend/public/.well-known/assetlinks.json)
     must include `io.gizu.android` and the installed build's public certificate.
2. Build the frontend from the repository root:

   ```sh
   npm --prefix frontend ci
   npm --prefix frontend run build
   ```

   Check both files exist in `frontend/dist/.well-known/`.

3. Deploy the frontend using the existing hosting service. Serve both paths
   directly over HTTPS, without redirects or the app's HTML fallback.
   On a Render Static Site, set these headers; on a Web Service, configure its server:

   | Path                                      | Header         | Value              |
   | ----------------------------------------- | -------------- | ------------------ |
   | `/.well-known/apple-app-site-association` | `Content-Type` | `application/json` |
   | `/.well-known/assetlinks.json`            | `Content-Type` | `application/json` |

4. Check the deployed responses without following redirects:

   ```sh
   curl --fail-with-body -i https://gizu.io/.well-known/apple-app-site-association
   curl --fail-with-body -i https://gizu.io/.well-known/assetlinks.json
   ```

## Expected result

Both URLs return HTTP 200 and JSON matching the intended source associations.
These HTTP checks confirm hosting only; test passkey access in the signed app too.

## Troubleshooting

See [association and Apple cache diagnostics](../internal/PASSKEY_TROUBLESHOOTING.md).
Hosting reference: [Render headers](https://render.com/docs/static-site-headers).
