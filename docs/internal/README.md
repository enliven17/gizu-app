# Internal engineering documentation

**Audience:** engineers and maintainers debugging or inspecting Gizu.

Use this folder for:

- Debugging guides, diagnostic commands and log interpretation.
- Native, backend and provider implementation details.
- Operation lifecycles, persistence, recovery and failure analysis.
- Incident reports, investigations and dated verification evidence.

Record the affected component, source revision and verification date where useful.
Distinguish confirmed findings from hypotheses, and mocked tests from live results.
Redact sensitive data before saving evidence.

Routine setup and operation instructions belong in [App guide](../app-guide/README.md).
Proposed changes belong in [Feature plans](../feature-plans/README.md).

## Documents

### Debugging and verification

- [Swap debugging](SWAP_DEBUGGING.md): device/backend setup, diagnostic layers and safe investigation.
- [Native signer verification](NATIVE_SIGNER_VERIFICATION.md): dated automated and device evidence.
- [Aurora signed-spending verification](../../research/outputs/aurora-signed-spending-verification.md): endpoint evidence and its limitations.
- [Swap transaction record](../../research/outputs/confidential-swap-tx-by-tx.md): the recorded mainnet AMZN run, transactions and visibility.

### Architecture and implementation references

- [Backend runtime](BACKEND_RUNTIME.md): Anvil integrity, provider qualification, recovery and deployment evidence.

- [Native signer](NATIVE_SIGNER.md): authorization, storage, portfolio, holdings and recovery contracts.
- [Aurora swap flow](AURORA_SWAP_FLOW.md): buy/sell diagrams and provider responsibilities.
- [Confidential Earn](CONFIDENTIAL_EARN.md): integration behavior and verification boundaries.
- [Mobile foundation](FOUNDATION.md): runtime ownership and shared engineering conventions.
- [Infinite lists](INFINITE_LISTS.md): shared pagination and virtualized-list contracts.
- [Toast feedback](TOASTS.md): customization, accessibility and native-modal behavior.
- [Account and notifications](ACCOUNT.md): demo/local account implementation reference.
- [Trading and transfers](TRADING.md): demo transaction lifecycle and mock-service contracts.

The two research reports linked above remain in `research/outputs/`.

These documents were organized without refreshing their technical claims.
Recorded versions, provider findings and verification results remain dated evidence;
check current source and services before relying on them.
