import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCatalog, type CatalogToken } from '../src/tokenCatalog.ts'

const tokens: CatalogToken[] = [
  { chainId: 4663, address: '0x1111111111111111111111111111111111111111', symbol: 'AAPL', name: 'Apple Robinhood Token', decimals: 18, logoURI: null, category: 'rwa', issuer: 'Robinhood', swapListed: true, fusionStatus: 'quote-required' },
  { chainId: 4663, address: '0x2222222222222222222222222222222222222222', symbol: 'MSFT', name: 'Microsoft Robinhood Token', decimals: 18, logoURI: null, category: 'rwa', issuer: 'Robinhood', swapListed: false, fusionStatus: 'quote-required' },
]

test('loads one explicit catalog page with server-side search', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  globalThis.fetch = async (input) => {
    requestedUrl = String(input)
    return Response.json({ list: [tokens[1]], page: 1, items: 1, total: 2 })
  }
  try {
    const page = await loadCatalog({ chainId: 4663, category: 'rwa', search: 'Robinhood', page: 1, items: 1 }, new AbortController().signal)
    assert.equal(requestedUrl, '/v1/tokens?chainId=4663&category=rwa&search=Robinhood&page=1&items=1')
    assert.equal(page.total, 2)
    assert.deepEqual(page.list.map((token) => token.symbol), ['MSFT'])
  } finally {
    globalThis.fetch = originalFetch
  }
})
