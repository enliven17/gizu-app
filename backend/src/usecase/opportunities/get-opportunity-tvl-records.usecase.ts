import type { Cache } from "../../ports/cache.port.ts";
import type {
  Opportunities,
  TvlRecord,
  TvlRecordsQuery,
} from "../../ports/opportunities.port.ts";

export class GetOpportunityTvlRecordsUseCase {
  constructor(
    private readonly opportunities: Opportunities,
    private readonly cache: Cache,
    private readonly namespace = "opportunities",
  ) {}

  async execute(input: TvlRecordsQuery): Promise<TvlRecord[]> {
    const cacheKey = `${this.namespace}:tvl:${input.id}:${input.items}`;
    const cached = await this.cache.get<TvlRecord[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const list = await this.opportunities.tvlRecords(input);
    await this.cache.set(cacheKey, list);
    return list;
  }
}
