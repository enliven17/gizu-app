import type { StoredOperation } from "@/domain/wallet/storedSigner";
import type { WalletHistory, WalletTransferService } from "@/domain/wallet/types";
import { transferProposal, walletAddressPattern } from "@/domain/wallet/transfers";
import { getStoredTransferSigner, type StoredTransferBridge } from "./nativeBridge";

const MAX_HISTORY_OPERATIONS = 256;
const MAX_OPERATION_STEPS = 32;
const MAX_ACCOUNT_INDEX = 15;
const MAX_TRANSFER_WEI = 100000000000000000n;
const operationIdPattern = /^[0-9a-f-]{36}$/i;
const transactionHashPattern = /^0x[0-9a-f]{64}$/i;
const noncePattern = /^(0|[1-9][0-9]{0,19})$/;
type StoredStep = StoredOperation["steps"][number];
const operationStatuses: readonly string[] = [
  "running",
  "needsAuthorization",
  "needsReview",
  "completed",
  "cancelled",
];
const stepStatuses: readonly string[] = [
  "planned",
  "signed",
  "pending",
  "unknown",
  "finalized",
  "reverted",
];

function parseStep(value: unknown, index: number): StoredStep {
  if (!value || typeof value !== "object") throw new Error("Invalid step");
  const step = value as Record<string, unknown>;
  if (
    step.index !== index ||
    typeof step.accountIndex !== "number" ||
    !Number.isInteger(step.accountIndex) ||
    step.accountIndex < 0 ||
    step.accountIndex > MAX_ACCOUNT_INDEX ||
    typeof step.from !== "string" ||
    !walletAddressPattern.test(step.from) ||
    typeof step.to !== "string" ||
    !walletAddressPattern.test(step.to) ||
    typeof step.valueWei !== "string" ||
    !/^[1-9][0-9]{0,17}$/.test(step.valueWei) ||
    BigInt(step.valueWei) > MAX_TRANSFER_WEI ||
    typeof step.status !== "string" ||
    !stepStatuses.includes(step.status)
  )
    throw new Error("Invalid step");
  const signed = step.status !== "planned";
  if (
    signed &&
    (typeof step.transactionHash !== "string" || !transactionHashPattern.test(step.transactionHash))
  )
    throw new Error("Missing transaction hash");
  if (signed && step.nonce === undefined) throw new Error("Missing nonce");
  if (
    step.nonce !== undefined &&
    (typeof step.nonce !== "string" || !noncePattern.test(step.nonce))
  )
    throw new Error("Invalid nonce");
  // Only public, validated fields cross into application state.
  return {
    index,
    accountIndex: step.accountIndex,
    from: step.from,
    to: step.to,
    valueWei: step.valueWei,
    status: step.status as StoredStep["status"],
    ...(signed ? { transactionHash: step.transactionHash as string } : {}),
    ...(step.nonce !== undefined ? { nonce: step.nonce as string } : {}),
    nonceConflict: step.nonceConflict === true,
  };
}

function parseOperation(value: unknown, walletId: string): StoredOperation {
  if (!value || typeof value !== "object") throw new Error("Invalid operation");
  const operation = value as Record<string, unknown>;
  if (
    typeof operation.operationId !== "string" ||
    !operationIdPattern.test(operation.operationId) ||
    operation.walletId !== walletId ||
    typeof operation.revision !== "number" ||
    !Number.isSafeInteger(operation.revision) ||
    operation.revision < 1 ||
    typeof operation.canResume !== "boolean" ||
    typeof operation.blocked !== "boolean" ||
    typeof operation.status !== "string" ||
    !operationStatuses.includes(operation.status) ||
    !Array.isArray(operation.steps) ||
    operation.steps.length < 1 ||
    operation.steps.length > MAX_OPERATION_STEPS
  )
    throw new Error("Invalid operation");
  return {
    operationId: operation.operationId,
    walletId,
    revision: operation.revision,
    status: operation.status as StoredOperation["status"],
    canResume: operation.canResume,
    blocked: operation.blocked,
    steps: operation.steps.map(parseStep),
  };
}

function historyEntries(operations: StoredOperation[], address: string): WalletHistory["entries"] {
  const sender = address.toLowerCase();
  return operations
    .flatMap((operation) =>
      operation.steps.flatMap((step) => {
        if (!step.transactionHash || step.from.toLowerCase() !== sender) return [];
        return [
          {
            transactionHash: step.transactionHash,
            status: step.status,
            nonce: step.nonce!,
            to: step.to,
            valueWei: step.valueWei,
          },
        ];
      }),
    )
    .reverse();
}

/** Validate the entire response before projecting history; never retain native private fields. */
export function storedHistory(input: unknown, walletId: string, address: string): WalletHistory {
  if (
    !Array.isArray(input) ||
    input.length > MAX_HISTORY_OPERATIONS ||
    !walletAddressPattern.test(address)
  )
    throw new Error("Invalid operation history");
  const ids = new Set<string>();
  const operations = input.map((value) => {
    const operation = parseOperation(value, walletId);
    if (ids.has(operation.operationId)) throw new Error("Invalid operation");
    ids.add(operation.operationId);
    return operation;
  });
  return {
    operations: operations.slice().reverse(),
    blocked: operations.some((operation) => operation.blocked),
    entries: historyEntries(operations, address),
  };
}
export function createStoredTransfers(
  walletId: string,
  getBridge: () => StoredTransferBridge | null = getStoredTransferSigner,
): WalletTransferService {
  function native() {
    const bridge = getBridge();
    if (!bridge) throw new Error("Native transfers unavailable");
    return bridge;
  }
  async function history(address: string) {
    return storedHistory(await native().listOperations(), walletId, address);
  }
  return {
    history,
    async send(address, recipient, amount) {
      if (!walletAddressPattern.test(address)) throw new Error("Invalid wallet");
      const proposal = JSON.parse(transferProposal("0", recipient, amount));
      proposal.transfers[0].expectedFrom = address;
      await native().executeOperation({ walletId, chainId: 10143, transfers: proposal.transfers });
      return history(address);
    },
    async resume(address, operationId, revision) {
      await native().resumeOperation(operationId, revision);
      return history(address);
    },
    async cancelOperation(address, operationId) {
      await native().cancelOperation(operationId);
      return history(address);
    },
    cancel() {
      getBridge()?.lock();
    },
  };
}
