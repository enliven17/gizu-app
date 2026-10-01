import {
  createPublicClient,
  decodeFunctionData,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  toHex,
} from "viem";
import type { Address, Hex, PublicClient, StateOverride } from "viem";
import {
  entryPoint08Address,
  toSimple7702SmartAccount,
  formatUserOperationRequest,
} from "viem/account-abstraction";
import { toAccount } from "viem/accounts";
import type { PrivateKeyAccount } from "viem/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createSmartAccountClient } from "permissionless";
import { prepareUserOperationForErc20Paymaster } from "permissionless/experimental/pimlico";
import { ROBINHOOD_PROFILE, robinhoodChain } from "./robinhood-vault.ts";
import { ceilDiv } from "./policy.ts";
import type { ExactCall } from "./vault.ts";
const gasFields = [
  "preVerificationGas",
  "callGasLimit",
  "verificationGasLimit",
  "paymasterPostOpGasLimit",
  "paymasterVerificationGasLimit",
] as const;
export type RobinhoodOperation = Partial<
  Record<(typeof gasFields)[number], bigint>
> & {
  sender: Address;
  paymaster?: Address;
  paymasterData?: Hex;
  nonce: bigint;
  callData: Hex;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  factory?: Address;
  factoryData?: Hex;
};
function uint(n: unknown, positive = false): bigint {
  if (
    typeof n !== "bigint" ||
    n < 0n ||
    n >= 1n << 256n ||
    (positive && n === 0n)
  )
    throw new Error("Invalid token sponsored quantity");
  return n;
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function robinhoodTokenCap(op: RobinhoodOperation): bigint {
  const data = op.paymasterData;
  if (!data || !/^0x[0-9a-f]{364,8192}$/i.test(data) || data.length % 2 !== 0)
    throw new Error("Malformed USDG paymaster data");
  const raw = data.slice(2).toLowerCase();
  if (
    !["02", "03"].includes(raw.slice(0, 2)) ||
    raw.slice(2, 4) !== "00" ||
    !same("0x" + raw.slice(28, 68), ROBINHOOD_PROFILE.token)
  )
    throw new Error("Unsupported USDG paymaster mode/token");
  const fee = uint(op.maxFeePerGas, true);
  uint(op.maxPriorityFeePerGas);
  if (op.maxPriorityFeePerGas > fee) throw new Error("Invalid token fee price");
  const gas = gasFields.reduce((sum, k) => sum + uint(op[k]), 0n),
    post = BigInt("0x" + raw.slice(68, 100)),
    rate = uint(BigInt("0x" + raw.slice(100, 164)), true);
  return uint(ceilDiv((uint(gas, true) + post) * fee * rate, 10n ** 18n), true);
}
export async function stabilizeRobinhoodApproval<T extends RobinhoodOperation>(
  initial: T,
  calls: ExactCall[],
  allowance: bigint,
  encode: (calls: ExactCall[]) => Promise<Hex>,
  estimate: (operation: T) => Promise<T>,
): Promise<T> {
  let operation = initial;
  for (let i = 0; i < 4; i++) {
    const cap = robinhoodTokenCap(operation),
      approval = ceilDiv(cap * 101n, 100n);
    const allowed =
      allowance < cap
        ? [
            {
              to: ROBINHOOD_PROFILE.token,
              value: 0n,
              data: encodeFunctionData({
                abi: erc20Abi,
                functionName: "approve",
                args: [ROBINHOOD_PROFILE.paymaster, approval],
              }),
            },
            ...calls,
          ]
        : calls;
    const callData = await encode(allowed),
      next = await estimate({ ...operation, callData }),
      checked = robinhoodTokenCap(next);
    if (next.callData !== callData)
      throw new Error("Bundler changed USDG calldata");
    if (
      allowed.length === calls.length
        ? allowance >= checked
        : approval >= checked && approval <= ceilDiv(checked * 101n, 100n)
    ) {
      return next;
    }
    operation = next;
  }
  throw new Error("USDG conservative paymaster approval did not stabilize");
}
export type RobinhoodFeePrice = {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};
export type RobinhoodPrepared = {
  operation: ReturnType<typeof formatUserOperationRequest>;
  feeCap: bigint;
  fees: RobinhoodFeePrice;
  delegation: Address;
  authorizationRequired: boolean;
  authorizationNonce: number;
  expiresAtMs?: number;
};
export async function createRobinhoodPaymaster(
  client: PublicClient,
  owner: Address,
  key: string,
) {
  if (!key || (await client.getChainId()) !== 4663)
    throw new Error("USDG paymaster unavailable");
  const refuse = async (): Promise<never> => {
    throw new Error("Read-only USDG preview cannot sign");
  };
  // Address-only custom account; this SDK's type restriction does not imply a key exists.
  const previewOwner = toAccount({
    address: owner,
    sign: refuse,
    signAuthorization: refuse,
    signMessage: refuse,
    signTypedData: refuse,
    signTransaction: refuse,
  }) as PrivateKeyAccount;
  const account = await toSimple7702SmartAccount({
    client,
    owner: previewOwner,
  });
  const code = (await client.getCode({ address: owner })) ?? "0x",
    expected = `0xef0100${account.authorization.address.slice(2)}`;
  if (code !== "0x" && !same(code, expected))
    throw new Error("Unknown Robinhood delegation");
  const transport = http(
    `https://api.pimlico.io/v2/4663/rpc?apikey=${encodeURIComponent(key)}`,
    { retryCount: 0, timeout: 12000 },
  );
  const pimlico = createPimlicoClient({
    chain: robinhoodChain,
    transport,
    entryPoint: { address: entryPoint08Address, version: "0.8" },
  });
  const [supported, quotes] = await Promise.all([
    pimlico.getSupportedEntryPoints(),
    pimlico.getTokenQuotes({
      tokens: [ROBINHOOD_PROFILE.token],
      chain: robinhoodChain,
    }),
  ]);
  if (
    !supported.some((a) => same(a, entryPoint08Address)) ||
    quotes.length !== 1 ||
    !same(quotes[0]!.token, ROBINHOOD_PROFILE.token) ||
    !same(quotes[0]!.paymaster, ROBINHOOD_PROFILE.paymaster)
  )
    throw new Error("Unsupported USDG sponsorship");
  const market = async () => {
    const f = (await pimlico.getUserOperationGasPrice()).standard;
    uint(f.maxFeePerGas, true);
    uint(f.maxPriorityFeePerGas);
    if (f.maxPriorityFeePerGas > f.maxFeePerGas)
      throw new Error("Invalid USDG fees");
    return f;
  };
  async function prepare(
    calls: ExactCall[],
    fees: RobinhoodFeePrice,
    stateOverride?: StateOverride,
  ): Promise<RobinhoodPrepared> {
    const bundler = createSmartAccountClient({
      account,
      client,
      chain: robinhoodChain,
      bundlerTransport: transport,
      paymaster: {
        getPaymasterStubData: pimlico.getPaymasterStubData,
        getPaymasterData: pimlico.getPaymasterStubData,
      },
      userOperation: {
        estimateFeesPerGas: async () => fees,
        prepareUserOperation: prepareUserOperationForErc20Paymaster(pimlico),
      },
    });
    const initial = await bundler.prepareUserOperation({
      account,
      calls,
      nonce: await account.getNonce({ key: 0n }),
      paymasterContext: { token: ROBINHOOD_PROFILE.token },
      ...(stateOverride ? { stateOverride } : {}),
    });
    const allowance = await client.readContract({
      address: ROBINHOOD_PROFILE.token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, ROBINHOOD_PROFILE.paymaster],
    });
    const op = await stabilizeRobinhoodApproval(
      initial,
      calls,
      allowance,
      async (allowed) => account.encodeCalls(allowed),
      async (operation) => {
        const gas = await pimlico.estimateUserOperationGas({
          ...operation,
          account,
          ...(stateOverride ? { stateOverride } : {}),
        });
        const stub = await pimlico.getPaymasterStubData({
          ...operation,
          ...gas,
          chainId: 4663,
          entryPointAddress: entryPoint08Address,
          context: { token: ROBINHOOD_PROFILE.token },
        });
        if (
          !stub.paymaster ||
          !stub.paymasterData ||
          ("paymasterAndData" in stub && stub.paymasterAndData !== undefined)
        )
          throw new Error("USDG stub format changed");
        return {
          ...operation,
          callGasLimit: uint(gas.callGasLimit, true),
          preVerificationGas: uint(gas.preVerificationGas, true),
          verificationGasLimit: uint(gas.verificationGasLimit, true),
          paymaster: stub.paymaster,
          paymasterData: stub.paymasterData,
          paymasterPostOpGasLimit: uint(
            stub.paymasterPostOpGasLimit ??
              gas.paymasterPostOpGasLimit ??
              operation.paymasterPostOpGasLimit,
          ),
          paymasterVerificationGasLimit: uint(
            stub.paymasterVerificationGasLimit ??
              gas.paymasterVerificationGasLimit ??
              operation.paymasterVerificationGasLimit,
          ),
        };
      },
    );
    if (
      !same(op.sender, owner) ||
      !op.paymaster ||
      !same(op.paymaster, ROBINHOOD_PROFILE.paymaster) ||
      op.maxFeePerGas !== fees.maxFeePerGas ||
      op.maxPriorityFeePerGas !== fees.maxPriorityFeePerGas ||
      !account.decodeCalls
    )
      throw new Error("USDG operation identity/fee changed");
    const decoded = await account.decodeCalls(op.callData),
      plain = (c: { to: Address; data?: Hex; value?: bigint }) => ({
        to: c.to.toLowerCase(),
        data: (c.data ?? "0x").toLowerCase(),
        value: c.value ?? 0n,
      });
    if (
      (decoded.length !== calls.length &&
        decoded.length !== calls.length + 1) ||
      JSON.stringify(decoded.slice(-calls.length).map(plain), (_, v) =>
        typeof v === "bigint" ? String(v) : v,
      ) !==
        JSON.stringify(calls.map(plain), (_, v) =>
          typeof v === "bigint" ? String(v) : v,
        )
    )
      throw new Error("USDG vault calls changed");
    const cap = robinhoodTokenCap(op);
    const header = op.paymasterData!.slice(2),
      validUntil = BigInt("0x" + header.slice(4, 16)),
      validAfter = BigInt("0x" + header.slice(16, 28)),
      nowSec = BigInt(Math.floor(Date.now() / 1000));
    if (
      validAfter > nowSec + 5n ||
      (validUntil !== 0n && validUntil <= nowSec + 15n)
    )
      throw new Error("Expired USDG paymaster stub");
    if (decoded.length === calls.length + 1) {
      const a = decoded[0]!;
      if (
        !same(a.to, ROBINHOOD_PROFILE.token) ||
        (a.value ?? 0n) !== 0n ||
        !a.data
      )
        throw new Error("Unknown USDG approval");
      const d = decodeFunctionData({ abi: erc20Abi, data: a.data });
      if (
        d.functionName !== "approve" ||
        !same(d.args[0], ROBINHOOD_PROFILE.paymaster) ||
        d.args[1] < cap ||
        d.args[1] > ceilDiv(cap * 101n, 100n)
      )
        throw new Error("USDG approval exceeds cap");
    } else if (allowance < cap) throw new Error("USDG allowance insufficient");
    const noFactory = op.factory === undefined && op.factoryData === undefined,
      stubFactory = op.factory === "0x7702" && op.factoryData === "0x";
    if (!noFactory && !stubFactory) throw new Error("Unexpected USDG factory");
    const latest = await client.getTransactionCount({ address: owner }),
      pending = await client.getTransactionCount({
        address: owner,
        blockTag: "pending",
      });
    if (latest !== pending) throw new Error("Pending Robinhood nonce");
    if (
      op.authorization &&
      (op.authorization.chainId !== 4663 ||
        op.authorization.nonce !== latest ||
        !same(op.authorization.address, account.authorization.address))
    )
      throw new Error("Changed Robinhood authorization binding");
    return {
      operation: formatUserOperationRequest(op),
      feeCap: cap,
      fees,
      delegation: account.authorization.address,
      authorizationRequired: code === "0x",
      authorizationNonce: latest,
      ...(validUntil !== 0n ? { expiresAtMs: Number(validUntil) * 1000 } : {}),
    };
  }
  return { market, prepare };
}
