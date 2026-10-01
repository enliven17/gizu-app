import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAuroraFeeQualification,
  qualifyAuroraFees,
  hasAuroraProfileQualification,
} from "../../../src/adapters/earn/fee-policy.ts";
const config = {
  version: "qualified-2026-10-01",
  routes: {
    source: {
      collectors: [{ recipient: "verified-provider.near", maximumBps: 4 }],
      maximumTotalBps: 4,
      referral: "verified-referral",
      integratorFeeBps: 0,
      applicationFeeAtoms: "0",
      qualificationReference: "operator-record-123",
    },
    returnEth: {
      collectors: [
        { recipient: "verified-provider.near", maximumBps: 25 },
        { recipient: "verified-second.near", maximumBps: 20 },
      ],
      maximumTotalBps: 45,
      referral: null,
      integratorFeeBps: 0,
      applicationFeeAtoms: "0",
      qualificationReference: "operator-record-456",
    },
  },
};
test("qualified route fees accept bounded actual fees and bind exact policy proof", () => {
  const policy = parseAuroraFeeQualification(JSON.stringify(config));
  const proof = qualifyAuroraFees(policy, "source", {
    appFees: [{ recipient: "verified-provider.near", fee: 4 }],
    referral: "verified-referral",
  });
  assert.equal(proof.version, config.version);
  assert.equal(proof.route, "source");
  assert.equal(proof.totalBps, 4);
  assert.deepEqual(proof.appFees, [
    { recipient: "verified-provider.near", fee: 4 },
  ]);
  assert.equal(
    qualifyAuroraFees(policy, "returnEth", {
      appFees: [
        { recipient: "verified-provider.near", fee: 25 },
        { recipient: "verified-second.near", fee: 20 },
      ],
    }).totalBps,
    45,
  );
});
test("unqualified routes, collectors, referrals and excessive/duplicate fees remain blocked", () => {
  const policy = parseAuroraFeeQualification(JSON.stringify(config));
  for (const [route, q] of [
    ["returnUsdc", { appFees: [] }],
    [
      "source",
      {
        appFees: [{ recipient: "attacker.near", fee: 4 }],
        referral: "verified-referral",
      },
    ],
    [
      "source",
      {
        appFees: [{ recipient: "verified-provider.near", fee: 5 }],
        referral: "verified-referral",
      },
    ],
    [
      "source",
      {
        appFees: [{ recipient: "verified-provider.near", fee: 4 }],
        referral: "attacker",
      },
    ],
    [
      "source",
      {
        appFees: [
          { recipient: "verified-provider.near", fee: 2 },
          { recipient: "verified-provider.near", fee: 2 },
        ],
        referral: "verified-referral",
      },
    ],
  ] as const)
    assert.throws(() => qualifyAuroraFees(policy, route, q));
  assert.throws(() =>
    parseAuroraFeeQualification(
      JSON.stringify({
        ...config,
        routes: { source: { ...config.routes.source, integratorFeeBps: 1 } },
      }),
    ),
  );
});

test("profile admission requires a separately qualified public Monad withdrawal route", () => {
  const rule = { ...config.routes.source, referral: null };
  const partial = parseAuroraFeeQualification(
    JSON.stringify({
      version: "lifecycle",
      routes: {
        source: rule,
        payoutEthereum: rule,
        returnUsdc: rule,
        returnEth: rule,
      },
    }),
  );
  assert.equal(hasAuroraProfileQualification(partial, 1), false);
  assert.throws(() =>
    qualifyAuroraFees(partial, "withdrawal", { appFees: [] }),
  );
  const full = parseAuroraFeeQualification(
    JSON.stringify({
      version: "lifecycle",
      routes: {
        ...("routes" in partial ? partial.routes : {}),
        withdrawal: rule,
      },
    }),
  );
  assert.equal(hasAuroraProfileQualification(full, 1), true);
  assert.equal(
    qualifyAuroraFees(full, "withdrawal", {
      appFees: [{ recipient: "verified-provider.near", fee: 4 }],
    }).route,
    "withdrawal",
  );
});
