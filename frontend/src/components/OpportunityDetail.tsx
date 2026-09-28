import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ExternalLink, Lock } from 'lucide-react'
import Chart from './Chart'
import SpotlightCard from './SpotlightCard'
import GlitchText from './GlitchText'
import { useOpportunity } from '../useOpportunities'

function money(value: number) {
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
}

function percent(value: number) {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

function unixDate(value: number) {
  return new Date(value * 1000).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function OpportunityDetail({
  id,
  onBack,
  onTrade,
}: {
  id: string
  onBack: () => void
  onTrade: (side: 'buy' | 'sell', asset: { name: string; ticker: string; price: number }) => void
}) {
  const load = useOpportunity(id)
  const [series, setSeries] = useState<number[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ items: '30' })
    fetch(`/v1/opportunities/${id}/tvl-records?${params}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error('tvl unavailable')
        }
        return response.json() as Promise<{ list: { total: number }[] }>
      })
      .then((body) => {
        if (controller.signal.aborted) {
          return
        }
        const points = body.list.map((row) => row.total)
        points.reverse()
        setSeries(points)
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return
        }
        setSeries([])
      })
    return () => controller.abort()
  }, [id])

  let chartUp = true
  if (series.length >= 2) {
    chartUp = series[series.length - 1] >= series[series.length - 2]
  }

  let tradeAsset: { name: string; ticker: string; price: number } | null = null
  if (load.kind === 'ready' && load.opportunity.tokens.length > 0) {
    const token = load.opportunity.tokens[0]
    tradeAsset = {
      name: load.opportunity.name,
      ticker: token.symbol,
      price: token.price,
    }
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-40 pt-14">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBack}
            className="glass-soft flex h-11 w-11 items-center justify-center rounded-2xl text-white/60"
          >
            <ChevronLeft size={18} />
          </button>
          {load.kind === 'ready' && load.opportunity.depositUrl.length > 0 && (
            <a
              href={load.opportunity.depositUrl}
              target="_blank"
              rel="noreferrer"
              className="glass-soft flex h-11 items-center gap-2 rounded-2xl px-4 font-mono text-[10px] uppercase tracking-widest text-white/60"
            >
              Deposit <ExternalLink size={14} />
            </a>
          )}
        </div>

        {load.kind === 'loading' && (
          <div className="mt-20 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/25">
            Loading vault
          </div>
        )}
        {load.kind === 'failed' && (
          <div className="mt-20 text-center font-mono text-[11px] uppercase tracking-[0.25em] text-white/25">
            {load.message}
          </div>
        )}
        {load.kind === 'ready' && (
          <>
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mt-8">
              <div className="flex items-center gap-3">
                <div className="glass flex h-14 max-w-[5.5rem] items-center justify-center truncate rounded-2xl px-3 font-mono text-[13px] font-bold uppercase text-neon">
                  {load.opportunity.protocol.name.slice(0, 4)}
                </div>
                <div className="min-w-0">
                  <h2 className="text-[26px] font-medium leading-tight tracking-tight">
                    <GlitchText>{load.opportunity.name}</GlitchText>
                  </h2>
                  <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-white/30">
                    <Lock size={10} /> {load.opportunity.protocol.name} · {load.opportunity.chain.name} ·{' '}
                    {load.opportunity.status}
                  </div>
                </div>
              </div>

              <div className="mt-7 flex items-end gap-3">
                <span className="font-mono text-[40px] font-normal leading-none tracking-tight text-neon">
                  {percent(load.opportunity.totalApr)}
                </span>
                <span className="mb-1 font-mono text-[11px] uppercase tracking-widest text-white/30">
                  total apr
                </span>
              </div>
            </motion.div>

            {series.length >= 2 && (
              <div className="mt-6">
                <Chart series={series} height={190} up={chartUp} />
              </div>
            )}

            <div className="mt-8 grid grid-cols-2 gap-2">
              {[
                { label: 'TVL', value: money(load.opportunity.tvl) },
                { label: 'APR', value: percent(load.opportunity.apr) },
                { label: 'Native APR', value: percent(load.opportunity.nativeApr) },
                { label: 'Daily rewards', value: money(load.opportunity.dailyRewards) },
                { label: 'Live campaigns', value: String(load.opportunity.liveCampaigns) },
                { label: 'Action', value: load.opportunity.action },
              ].map((m, i) => (
                <motion.div
                  key={m.label}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.04 * i }}
                >
                  <SpotlightCard className="h-full px-4 py-5">
                    <div className="truncate font-mono text-[17px] font-normal leading-none tracking-tight text-white/90">
                      {m.value}
                    </div>
                    <div className="mt-2.5 font-mono text-[9px] uppercase tracking-[0.22em] text-white/30">
                      {m.label}
                    </div>
                  </SpotlightCard>
                </motion.div>
              ))}
            </div>

            {load.opportunity.campaigns.length > 0 && (
              <div className="mt-7">
                <h3 className="mb-3 text-[20px] font-medium tracking-tight">Campaigns</h3>
                <div className="space-y-3">
                  {load.opportunity.campaigns.map((campaign) => (
                    <div key={campaign.id} className="glass rounded-3xl p-5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-[12px] uppercase tracking-wider text-neon/80">
                          {campaign.type}
                        </span>
                        <span className="font-mono text-[13px] text-white/80">{percent(campaign.apr)}</span>
                      </div>
                      <div className="mt-3 space-y-2 font-mono text-[11px] text-white/40">
                        <div className="flex justify-between gap-3">
                          <span>Daily rewards</span>
                          <span className="text-white/70">{money(campaign.dailyRewards)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Start</span>
                          <span className="text-white/70">{unixDate(campaign.startTimestamp)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>End</span>
                          <span className="text-white/70">{unixDate(campaign.endTimestamp)}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Creator</span>
                          <span className="truncate text-white/70">{campaign.creatorAddress}</span>
                        </div>
                        <div className="flex justify-between gap-3">
                          <span>Campaign id</span>
                          <span className="truncate text-white/70">{campaign.campaignId}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </>
        )}
      </div>

      {tradeAsset && (
        <div className="absolute inset-x-0 bottom-0 z-20 flex gap-3 bg-gradient-to-t from-ink via-ink/90 to-transparent px-5 pb-8 pt-10">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onTrade('buy', tradeAsset)}
            className="neon-btn relative flex h-15 flex-1 items-center justify-center overflow-hidden rounded-2xl py-5 text-[15px] font-semibold"
          >
            <span className="relative">Buy</span>
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onTrade('sell', tradeAsset)}
            className="sell-btn flex flex-1 items-center justify-center rounded-2xl py-5 text-[15px] font-semibold"
          >
            Sell
          </motion.button>
        </div>
      )}
    </div>
  )
}
