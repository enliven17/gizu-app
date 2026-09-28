import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { loadCatalog, type CatalogToken } from '../tokenCatalog'

const networks = [
  { id: 4663, label: 'Robinhood' },
  { id: 1, label: 'Ethereum' },
  { id: 143, label: 'Monad' },
] as const
const PAGE_SIZE = 60

export default function TokenCatalog() {
  const [chainId, setChainId] = useState<number>(4663)
  const [category, setCategory] = useState<'all' | 'rwa'>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [tokens, setTokens] = useState<CatalogToken[]>([])

  useEffect(() => {
    const controller = new AbortController()
    setStatus('loading')
    if (page === 0) {
      setTokens([])
      setTotal(0)
    }
    loadCatalog({ chainId, category, search, page, items: PAGE_SIZE }, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setTokens((current) => page === 0 ? result.list : [...current, ...result.list])
        setTotal(result.total)
        setStatus('ready')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setStatus('error')
      })
    return () => controller.abort()
  }, [chainId, category, search, page])

  return (
    <div className="mx-auto min-h-0 w-full max-w-[1000px] flex-1 overflow-y-auto px-5 pb-32 pt-12 lg:px-12 lg:pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-neon/70">1inch asset discovery</div>
          <h1 className="mt-2 text-[34px] font-medium tracking-tight lg:text-[52px]">Explore tokens</h1>
          <p className="mt-2 max-w-[620px] text-[13px] leading-relaxed text-white/45">
            Browse Robinhood Stock Tokens and RWA assets on Ethereum and Monad. A listed token is not a live swap quote.
          </p>
        </div>
        <div className="rounded-full border border-neon/20 bg-neon/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-neon">
          Discovery only
        </div>
      </div>

      <div className="mt-8 flex gap-2 overflow-x-auto pb-1" aria-label="Network">
        {networks.map((network) => (
          <button key={network.id} type="button" onClick={() => {
            setChainId(network.id)
            setCategory(network.id === 4663 ? 'all' : 'rwa')
            setSearch('')
            setPage(0)
          }} className={`shrink-0 rounded-full px-4 py-2.5 font-mono text-[12px] ${chainId === network.id ? 'bg-neon text-ink' : 'glass-soft text-white/60'}`}>
            {network.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" onClick={() => { setCategory('rwa'); setPage(0) }} className={`rounded-xl px-4 py-2 font-mono text-[11px] ${category === 'rwa' ? 'border border-neon/35 bg-neon/10 text-neon' : 'glass-soft text-white/45'}`}>RWA</button>
        <button type="button" onClick={() => { setCategory('all'); setPage(0) }} className={`rounded-xl px-4 py-2 font-mono text-[11px] ${category === 'all' ? 'border border-neon/35 bg-neon/10 text-neon' : 'glass-soft text-white/45'}`}>All assets</button>
      </div>

      <label className="glass-soft mt-5 flex items-center gap-3 rounded-2xl px-4 py-3 text-white/35">
        <Search size={17} />
        <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="Search symbol, name, issuer or address" className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-white/30" />
      </label>

      <div className="mt-6 flex items-center justify-between font-mono text-[11px] text-white/35">
        <span>{status === 'ready' ? `${total.toLocaleString()} assets` : status === 'loading' ? 'Loading assets…' : 'Catalog unavailable'}</span>
        <span>Chain ID {chainId}</span>
      </div>

      {status === 'error' && <div className="glass mt-4 rounded-2xl p-5 text-[13px] text-white/65">Could not load the live catalog. Check the API connection and try this network again.</div>}
      {status === 'ready' && total === 0 && <div className="glass mt-4 rounded-2xl p-5 text-[13px] text-white/50">{category === 'rwa' && !search.trim() ? 'No RWA-tagged assets in the current 1inch list for this network.' : 'No matching assets found.'}</div>}
      {tokens.length > 0 && <div className="mt-4 space-y-2">
        {tokens.map((token) => (
          <div key={`${token.chainId}:${token.address}`} className="glass flex items-center gap-3 rounded-2xl px-4 py-3">
            {token.logoURI ? <img src={token.logoURI} alt="" className="h-10 w-10 rounded-full bg-white/5 object-contain" loading="lazy" /> : <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neon/10 font-mono text-[11px] text-neon">{token.symbol.slice(0, 3)}</div>}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[13px] font-semibold text-white">{token.symbol}</span>
                {token.category === 'rwa' && <span className="rounded-md bg-neon/10 px-1.5 py-0.5 font-mono text-[9px] text-neon">RWA</span>}
              </div>
              <div className="truncate text-[12px] text-white/45">{token.name}{token.issuer ? ` · ${token.issuer}` : ''}</div>
              <div className="mt-1 truncate font-mono text-[10px] text-white/25" title={token.address}>{token.address}</div>
            </div>
            <div className="shrink-0 text-right font-mono text-[10px]">
              <div className={token.swapListed ? 'text-neon/80' : 'text-white/35'}>{token.swapListed ? '1inch listed' : 'Not 1inch listed'}</div>
              <div className="mt-1 text-white/30">Fusion quote needed</div>
            </div>
          </div>
        ))}
      </div>}
      {status === 'ready' && tokens.length < total && <button type="button" onClick={() => setPage((current) => current + 1)} className="glass-soft mt-4 w-full rounded-2xl py-3 font-mono text-[12px] text-neon">Show more ({total - tokens.length} remaining)</button>}
    </div>
  )
}
