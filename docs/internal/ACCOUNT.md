# Account and notifications (M5)

This reference describes demo/local account behavior. For native-mode availability
and real wallet identity, use the [current capability matrix](../feature-plans/PARITY.md). Fixture
profile and notification data are not real account services.

M5 provides account and secondary-page journeys while authentication, account
identity and financial services remain development fixtures. Real passkey
registration/authentication is the next integration step; M5 creates no credential.

## Implemented behavior and availability

| Area                      | Outcome                                                                     | Boundary                                                                                          |
| ------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Account details           | Profile, member number and complete synthetic address                       | Fixture, not an authenticated identity or receiving address                                       |
| Copy address              | Native clipboard write with success/failure feedback and retry              | Expo Clipboard integration; success shown only after acknowledgment                               |
| Notifications             | Open full text, mark read/unread, mark all, unread count, refresh and retry | Mock service, session scoped; no push delivery or trade reconciliation                            |
| Push alerts               | Save an on/off preference on the Push alerts page; default off              | Local preference only; does not request permission, register a device or affect the inbox         |
| Currency                  | USD selected; EUR/GBP/TRY visibly unavailable                               | No FX rates or relabeled balances; financial asset units stay unchanged                           |
| Statements                | Save Monthly, Quarterly or On request; default Monthly                      | Frequency preference only; no scheduled delivery                                                  |
| Statement archive/request | Empty archive and disabled request action with explanation                  | Unavailable until a document service exists; no invented PDFs                                     |
| Passkey wallet            | Method/status information and copy address                                  | Credential, backup and guardian recovery unavailable                                              |
| Transaction signing       | Describes the existing explicit review/confirm step                         | No claimed biometric policy, enforced spending caps or cooldown; policy editing unavailable       |
| Contact desk              | Channel availability information                                            | Messaging, callback booking and email destination unavailable; nothing is sent                    |
| Terms/disclosures         | General risk information                                                    | Agreement, risk, privacy and fee documents unavailable until approved publications are supplied   |
| Disconnect                | Clear this account's preferences, then end the session                      | Unmount clears inbox, ledger, snapshots and protected navigation; no remote credential revocation |

The static inbox intentionally avoids claims that a current order settled, that a
credential was used, or that a downloadable statement exists. It is not generated
from M4 operations. Operation outcomes remain in Activity and the operation status
flow. Opening an unread notification expands its full text and acknowledges it;
failed acknowledgment leaves it unread. Mark-all sends only unread IDs. Read state
survives screen changes and refresh within the session, but resets on disconnect
or restart. No notification content is persisted.

All secondary pages retain content Back controls, safe fallback to Settings/Home,
protected navigation, large-text wrapping and scroll padding around bottom tabs.
There are no new top navigation bars. Unsupported account pages show a fallback
instead of a blank screen. The notifications deep link is protected while signed out.

## Persistence contract

`src/storage/preferences.ts` wraps AsyncStorage 2.2.0. Only this normalized object
is stored under `gizu:preferences:v1:<encoded-account-id>`:

```json
{ "version": 1, "alerts": false, "currency": "USD", "statements": "Monthly" }
```

- The mock session uses `development-member-0417`; an injected session can supply
  an account ID. Real account identifiers must come from the authenticated adapter
  during passkey/backend integration, never from user-entered navigation parameters.
- Missing, corrupt or unknown-version JSON falls back to defaults. Fields are
  normalized independently; invalid booleans/frequencies default and currency is
  always USD. Unknown fields are never written back.
- A storage read failure does not silently claim saved settings loaded. Editing
  stays disabled until Retry preferences succeeds. Financial screens remain usable.
- Changes are committed to UI state only after a successful write. While writing,
  additional preference changes and disconnect are blocked. Failure retains the
  last committed value, explains the error and allows the same action to retry.
- Explicit disconnect removes only the current account's key, not all app storage.
  If removal fails, the session remains open with a retry message. Late hydration
  cannot restore state after disconnect. This cleanup policy is for the current
  local prototype; real session invalidation must not depend on local storage health.
- Preferences survive process restart until explicit disconnect. Authentication,
  financial data and the inbox do not. No key material, tokens, address, profile,
  notification payload or balance is written to AsyncStorage.

Feature controllers own loading, mutation guards and stale-result protection.
`AccountProvider` accepts replaceable storage/clipboard adapters;
`NotificationProvider` creates a fresh default mock service per session.
`AppRoot` exposes injection points for functional tests and future integrations.
Primitive components receive values and callbacks without owning feature logic.

## Verification and next integration

Functional tests render real screens, controllers, navigation and providers.
Only storage, native clipboard and service boundaries are mocked. Coverage includes
read/unread/mark-all, empty/loading/failure/retry, preference hydration/write failure,
remount persistence, account-scoped cleanup, duplicate prevention, late results,
copy success/failure and unavailable secondary actions. Native QA is recorded in
[FOUNDATION.md](FOUNDATION.md); Jest does not prove OS permissions or biometrics.

Before real passkeys, select the credential/wallet provider, relying-party domain,
platform association setup, account identity/session contract and recovery model.
Replace fixture identity and security status with verified provider data. Push,
FX, document delivery, support and legal publishing remain separately configured
integrations; completing passkeys alone must not enable those controls.

Settings no longer displays the Preferences section (Currency and Statements).
The Push alerts row opens a separate page with the alert preference switch.

The account address and copy action appear directly on Settings, including for
mainnet wallets, rather than inside the Passkey wallet information page.
