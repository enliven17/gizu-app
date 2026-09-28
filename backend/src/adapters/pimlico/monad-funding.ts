import { createSmartAccountClient } from "permissionless";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { prepareUserOperationForErc20Paymaster } from "permissionless/experimental/pimlico";
import { createPublicClient, defineChain, erc20Abi, getAddress, http, size, sliceHex, type Address, type Hex } from "viem";
import { toAccount } from "viem/accounts";
import { entryPoint08Address, formatUserOperationRequest, toSimple7702SmartAccount } from "viem/account-abstraction";
import { InfrastructureError } from "../../domain/errors/infrastructure-error.ts";

export const MONAD_CHAIN_ID = 143;
export const MONAD_USDC = getAddress("0x754704bc059f8c67012fed69bc8a327a5aafb603");
export const MONAD_PAYMASTER = getAddress("0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402");
const monad = defineChain({
  id: MONAD_CHAIN_ID,
  name: "Monad Mainnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
});

export type UnsignedAuthorization = { chainId: number; address: Address; nonce: number };
export type PreparedFunding = {
  userOperation: Record<string, unknown>;
  authorization: UnsignedAuthorization | null;
  feeCapAtoms: string;
};
export type FundingReceipt = { found: false } | { found: true; success: boolean; transactionHash: Hex };

type Simple7702Owner = Parameters<typeof toSimple7702SmartAccount>[0]["owner"];

function watchOnly(address: Address): Simple7702Owner {
  const refuse = async (): Promise<never> => {
    throw new Error("The gateway never signs for a wallet");
  };
  return {
    ...toAccount({ address, signMessage: refuse, signTransaction: refuse, signTypedData: refuse }),
    sign: refuse,
    signAuthorization: refuse,
  } as Simple7702Owner;
}

// Mirrors the research `signedErc20FeeCap`; the phone recomputes it before signing.
export function signedErc20FeeCap(operation: {
  paymasterData?: Hex;
  preVerificationGas: bigint;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  paymasterPostOpGasLimit?: bigint;
  paymasterVerificationGasLimit?: bigint;
  maxFeePerGas: bigint;
}): bigint {
  const data = operation.paymasterData;
  if (!data || size(data) < 182) throw new Error("Invalid signed ERC-20 paymaster data");
  const mode = Number(BigInt(sliceHex(data, 0, 1))) >> 1;
  if (mode !== 1 || getAddress(sliceHex(data, 14, 34)) !== MONAD_USDC) throw new Error("Unexpected paymaster mode or token");
  const postOpGas = BigInt(sliceHex(data, 34, 50));
  const exchangeRate = BigInt(sliceHex(data, 50, 82));
  const gas = operation.preVerificationGas + operation.callGasLimit + operation.verificationGasLimit +
    (operation.paymasterPostOpGasLimit ?? 0n) + (operation.paymasterVerificationGasLimit ?? 0n);
  return (gas + postOpGas) * operation.maxFeePerGas * exchangeRate / 10n ** 18n;
}

export class PimlicoMonadFunding {
  private readonly rpc: string;
  private readonly client;

  constructor(private readonly key: string, monadRpc = "https://rpc.monad.xyz") {
    this.rpc = `https://api.pimlico.io/v2/${MONAD_CHAIN_ID}/rpc?apikey=${encodeURIComponent(key)}`;
    this.client = createPublicClient({ chain: monad, transport: http(monadRpc, { timeout: 20_000 }) });
  }

  async prepare(owner: Address, recipient: Address, amount: bigint): Promise<PreparedFunding> {
    return this.guard("prepare", async () => {
      const account = await toSimple7702SmartAccount({ client: this.client, owner: watchOnly(owner) });
      const pimlico = this.pimlico();
      const fees = (await pimlico.getUserOperationGasPrice()).standard;
      const bundler = createSmartAccountClient({
        account,
        client: this.client,
        chain: monad,
        bundlerTransport: http(this.rpc, { timeout: 30_000 }),
        paymaster: pimlico,
        userOperation: {
          estimateFeesPerGas: async () => fees,
          prepareUserOperation: prepareUserOperationForErc20Paymaster(pimlico),
        },
      });
      const prepared = await bundler.prepareUserOperation({
        account,
        paymasterContext: { token: MONAD_USDC },
        calls: [{ to: MONAD_USDC, abi: erc20Abi, functionName: "transfer", args: [recipient, amount] }],
      });
      const { signature: _signature, eip7702Auth, ...userOperation } = formatUserOperationRequest(prepared) as Record<string, unknown> & {
        eip7702Auth?: { chainId: Hex; address: Address; nonce: Hex };
      };
      return {
        userOperation,
        authorization: eip7702Auth
          ? { chainId: Number(eip7702Auth.chainId), address: getAddress(eip7702Auth.address), nonce: Number(eip7702Auth.nonce) }
          : null,
        feeCapAtoms: signedErc20FeeCap(prepared).toString(),
      };
    });
  }

  async submit(rpcOperation: Record<string, unknown>): Promise<Hex> {
    return this.guard("submit", async () => {
      const client = createPublicClient({ transport: http(this.rpc, { timeout: 30_000, retryCount: 0 }) });
      return client.request({
        method: "eth_sendUserOperation" as never,
        params: [rpcOperation, entryPoint08Address] as never,
      }) as Promise<Hex>;
    });
  }

  async receipt(hash: Hex): Promise<FundingReceipt> {
    return this.guard("receipt", async () => {
      const found = await this.pimlico().getUserOperationReceipt({ hash }).catch((error: { name?: string }) => {
        if (error.name === "UserOperationReceiptNotFoundError") return null;
        throw error;
      });
      if (!found) return { found: false } as const;
      return { found: true, success: found.success, transactionHash: found.receipt.transactionHash } as const;
    });
  }

  private pimlico() {
    return createPimlicoClient({
      chain: monad,
      transport: http(this.rpc, { timeout: 30_000 }),
      entryPoint: { address: entryPoint08Address, version: "0.8" },
    });
  }

  private async guard<T>(what: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const raw = error instanceof Error ? (error as { shortMessage?: string }).shortMessage ?? error.message : String(error);
      const reason = raw.split(this.key).join("<key>").split(encodeURIComponent(this.key)).join("<key>").slice(0, 200);
      throw new InfrastructureError(502, "PIMLICO_FAILED", `Pimlico ${what} failed: ${reason}`);
    }
  }
}
