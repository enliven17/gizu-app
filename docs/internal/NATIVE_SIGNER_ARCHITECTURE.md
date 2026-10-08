# Stored-wallet architecture

**Complexity: 2 — Technical.** [Signer overview](NATIVE_SIGNER.md).

Extracted from the signer reference on 2026-10-08. This split preserves the
recorded implementation details; it is not a new device, provider or security
verification. See [dated verification evidence](NATIVE_SIGNER_VERIFICATION.md).

**Version note:** the sections below describe the original version-1 backup.
The current [TypeScript contract](../../mobile/src/domain/wallet/storedSigner.ts)
declares backup version 2. Consult current native codecs before making format or
compatibility assumptions; the historical details below are not a v2 specification.

## Stored-wallet replacement boundary

The retained `modules/gizu-signer` implementation is disconnected from the app
and excluded from Android/iOS autolinking. No legacy lookup or fallback remains
in application access or diagnostic entry points. Existing installed binaries
require rebuilding to remove the old native registration. Legacy JavaScript adapters
are retained under `src/development/legacySigner`; normal wallet composition requires
a stored-wallet identity and never selects these adapters.

The replacement is named `GizuStoredSigner`; its versioned public contract is
`src/domain/wallet/storedSigner.ts`. Android and iOS 18+ development builds implement native
storage, passkey create/open, verified backup/restore and exact transfers in
`modules/gizu-stored-signer`.
Only backup-verified wallets enter app sessions. Other platforms are unsupported;
normal startup remains native-only. The isolated testnet transfer diagnostic uses the replacement operation journal.
Normal Home reads Monad mainnet USDC; that view does not grant mainnet transfer authority.

The contract provides wallet states (absent, backupRequired, ready, recoveryRequired),
native create/open/backup/restore ceremonies and operation execute/status/resume/
cancel methods. Only ready wallets expose account metadata for app sessions;
backup-required wallets cannot fund or transact. Native code owns file selection,
backup plaintext, secret material and approval. Resume checks the operation
revision, reconciles first and obtains fresh native authorization. `lock` ends
authority without deleting wallet storage or broadcast evidence. Native failures
will use sanitized errors; no key material, raw signed bytes or file contents cross
the app bridge.

The replacement storage namespace is `io.gizu.storedwallet.v1`; backup format
`gizu-stored-wallet` version 1; derivation `gizu-stored-evm-v1`; recovery PRF salt
is SHA-256 of UTF-8 `gizu.stored-wallet.recovery-prf.v1`. These identities are distinct
from the preserved signer. RP remains gizu.io. Random 32-byte wallet entropy uses
English BIP-39, empty passphrase and m/44'/60'/0'/0/i for indices 0–15. Account 0
remains the app account. The registered passkey authorizes locally stored-wallet
use; PRF encrypts backups rather than determining wallet addresses.

Storage, passkey authorization, verified onboarding backup and transfer/resume are
implemented; see [the migration plan](SIGNER_MIGRATION.md). No old state or provider passkeys
are deleted or migrated. Web wallet sharing and physical iOS acceptance are deferred.
