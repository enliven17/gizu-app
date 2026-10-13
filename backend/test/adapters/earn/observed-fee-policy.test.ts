import test from "node:test";
import assert from "node:assert/strict";
import {
  observedAuroraFeeQualification,
  qualifyAuroraFees,
  hasAuroraProfileQualification,
} from "../../../src/adapters/earn/fee-policy.ts";

test("portal zero-integrator policy accepts both observed service referrals with bounded route fees", () => {
  const policy = observedAuroraFeeQualification;
  assert.equal(hasAuroraProfileQualification(policy, 4663), true);
  assert.equal(hasAuroraProfileQualification(policy, 1), false);
  for (const referral of ["aurora-jh500bnyo9", "aurora-1u3j2qzclc"]) {
    for (const route of ["source", "withdrawal"]) {
      assert.equal(
        qualifyAuroraFees(policy, route, {
          referral,
          appFees: [{ recipient: "widget_collect.sputnik-dao.near", fee: 4 }],
        }).totalBps,
        4,
      );
    }
    for (const route of ["payoutRobinhood", "returnRobinhood"]) {
      assert.equal(
        qualifyAuroraFees(policy, route, {
          referral,
          appFees: [
            { recipient: "widget_collect.sputnik-dao.near", fee: 25 },
            {
              recipient:
                "2238fd089f1c92b206c218cd16b8676cb98964e0d50f8ab729c6396a81e07805",
              fee: 20,
            },
          ],
        }).integratorFeeBps,
        0,
      );
    }
  }
  for (const q of [
    {
      referral: "aurora-unknown",
      appFees: [{ recipient: "widget_collect.sputnik-dao.near", fee: 4 }],
    },
    {
      referral: "aurora-jh500bnyo9",
      appFees: [{ recipient: "widget_collect.sputnik-dao.near", fee: 5 }],
    },
    {
      referral: "aurora-jh500bnyo9",
      appFees: [{ recipient: "unknown.near", fee: 4 }],
    },
  ])
    assert.throws(() => qualifyAuroraFees(policy, "source", q));
});
