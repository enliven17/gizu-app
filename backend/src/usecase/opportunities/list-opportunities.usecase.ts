import type { Cache } from "../../ports/cache.port.ts";
import type {
  ListOpportunitiesQuery,
  Opportunities,
  OpportunityPage,
} from "../../ports/opportunities.port.ts";

export class ListOpportunitiesUseCase {
  constructor(
    private readonly opportunities: Opportunities,
    private readonly cache: Cache,
  ) {}

  async execute(input: ListOpportunitiesQuery): Promise<OpportunityPage> {
    const cacheKey = `opportunities:list:${input.protocol}:${input.chainId}:${input.page}:${input.items}:${input.search}`;
    const cached = await this.cache.get<OpportunityPage>(cacheKey);
    if (cached !== null) {
      return cached;
    }
    const page = await this.opportunities.list(input);
    await this.cache.set(cacheKey, page);
    return page;
  }
}
