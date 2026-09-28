import assert from "node:assert/strict";
import { test } from "node:test";
import { selectLiveCampaigns } from "../../src/domain/live-campaigns.ts";

test("keeps the current window and drops ended or future campaigns", () => {
  const now = 1_790_254_800;
  const live = selectLiveCampaigns(
    [
      { id: "ended", startTimestamp: now - 604_800, endTimestamp: now },
      { id: "live", startTimestamp: now, endTimestamp: now + 604_800 },
      { id: "future", startTimestamp: now + 604_800, endTimestamp: now + 1_209_600 },
    ],
    now,
  );

  assert.deepEqual(
    live.map((campaign) => campaign.id),
    ["live"],
  );
});
