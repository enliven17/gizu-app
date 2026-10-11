import { getAddress } from "viem";
import {
  RobinhoodDepositPlanner,
  createRobinhoodPlannerProviders,
  type RobinhoodPlannerConfig,
  type RobinhoodPlannerProviders,
  type RobinhoodState,
} from "./robinhood-deposit-planner.ts";
import { simulateProspectiveRobinhoodDeposit } from "./robinhood-simulation.ts";

export type RobinhoodPreviewRequest = {
  owner: string;
  expectedUsdgAtoms: string;
  operationId: string;
  revision: number;
};
/** Reuses the funded planner's math only within explicitly hypothetical provider bindings. */
export class RobinhoodDepositPreviewPlanner {
  constructor(
    private config: RobinhoodPlannerConfig,
    private injected?: RobinhoodPlannerProviders,
    private now: () => number = Date.now,
  ) {}
  async preview(request: RobinhoodPreviewRequest) {
    if (
      !/^[1-9][0-9]{0,77}$/.test(request.expectedUsdgAtoms) ||
      BigInt(request.expectedUsdgAtoms) >= 1n << 256n
    )
      throw new Error("Invalid preview budget");
    const expected = BigInt(request.expectedUsdgAtoms),
      actual =
        this.injected ?? createRobinhoodPlannerProviders(this.config, this.now);
    let real: RobinhoodState | undefined;
    const prospective: RobinhoodPlannerProviders = {
      ...actual,
      readState: async (owner) => {
        real = await actual.readState(owner);
        if (real.token !== 0n || real.shares !== 0n)
          throw new Error("Preview requires unused destination");
        return { ...real, token: expected };
      },
      simulate: this.injected
        ? actual.simulate
        : (state, amount) => {
            if (!this.config.anvilPath)
              throw new Error("Preview simulation unavailable");
            return simulateProspectiveRobinhoodDeposit({
              rpcUrl: this.config.rpcUrl,
              anvilPath: this.config.anvilPath,
              timeoutMs: this.config.timeoutMs,
              block: state.block,
              owner: getAddress(state.owner),
              amount,
              expectedUsdg: expected,
            });
          },
      assertFresh: async (_state, fees) => {
        if (!real) throw new Error("Missing preview state");
        await actual.assertFresh(real, fees);
      },
    };
    const plan = await new RobinhoodDepositPlanner(
      this.config,
      prospective,
      this.now,
    ).plan(request);
    return {
      kind: "preview" as const,
      readOnly: true as const,
      executionAvailable: false as const,
      assumption: "hypothetical-USDG-funding-isolated-fork" as const,
      operationId: plan.operationId,
      revision: plan.revision,
      profileId: plan.profileId,
      chainId: plan.chainId,
      owner: plan.owner,
      vault: plan.vault,
      token: plan.token,
      tokenDecimals: plan.tokenDecimals,
      shareDecimals: plan.shareDecimals,
      expectedUsdgAtoms: request.expectedUsdgAtoms,
      referenceBlockNumber: plan.referenceBlockNumber,
      referenceBlockHash: plan.referenceBlockHash,
      referenceTimestampMs: plan.referenceTimestampMs,
      quotedAtMs: plan.quotedAtMs,
      expiresAtMs: plan.expiresAtMs,
      policyVersion: plan.policyVersion,
      depositAmount: plan.depositAmount,
      depositFeeBudget: plan.depositFeeBudget,
      withdrawalReserve: plan.withdrawalReserve,
      previewShares: plan.previewShares,
      maxSharePrice: plan.maxSharePrice,
    };
  }
}
export type RobinhoodDepositPreview = Awaited<
  ReturnType<RobinhoodDepositPreviewPlanner["preview"]>
>;
