export type TimedCampaign = {
  startTimestamp: number;
  endTimestamp: number;
};

export function selectLiveCampaigns<T extends TimedCampaign>(
  campaigns: T[],
  nowUnixSeconds: number,
): T[] {
  return campaigns.filter(
    (campaign) =>
      campaign.startTimestamp <= nowUnixSeconds &&
      nowUnixSeconds < campaign.endTimestamp,
  );
}
