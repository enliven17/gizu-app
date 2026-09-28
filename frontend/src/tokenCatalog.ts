export type CatalogToken = {
  chainId: number
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI: string | null
  category: 'rwa' | 'other'
  issuer: 'Robinhood' | null
  swapListed: boolean
  fusionStatus: 'quote-required'
}

export type CatalogPage = { list: CatalogToken[]; page: number; items: number; total: number }
export type CatalogQuery = { chainId: number; category: 'all' | 'rwa'; search: string; page: number; items: number }

export async function loadCatalog(input: CatalogQuery, signal: AbortSignal): Promise<CatalogPage> {
  const query = new URLSearchParams({
    chainId: String(input.chainId),
    category: input.category,
    search: input.search,
    page: String(input.page),
    items: String(input.items),
  })
  const response = await fetch(`/v1/tokens?${query}`, { signal })
  if (!response.ok) throw new Error('Token catalog unavailable')
  const body = await response.json() as CatalogPage
  if (!Array.isArray(body.list) || body.page !== input.page || body.items !== input.items || !Number.isInteger(body.total)) {
    throw new Error('Invalid token catalog page')
  }
  return body
}
