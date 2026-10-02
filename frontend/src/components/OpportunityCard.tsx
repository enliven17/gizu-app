import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Lock } from 'lucide-react'
import Sparkline from './Sparkline'
import type { Opportunity } from '../opportunities'

function money(value: number | null) {
  if (value === null) return 'Unavailable'
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  })
}

export default function OpportunityCard({
  opportunity,
  delay = 0,
  className = 'aspect-square',
  chartHeight = 40,
  onOpen,
}: {
  opportunity: Opportunity
  delay?: number
  className?: string
  chartHeight?: number
  onOpen: (id: string) => void
}) {
  const [series, setSeries] = useState<number[]>([])

  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({ items: '30' })
    fetch(`/v1/opportunities/${opportunity.id}/tvl-records?${params}`, {
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
  }, [opportunity.id])

  let up = true
  let changeText = ''
  if (series.length >= 2) {
    const previous = series[series.length - 2]
    const latest = series[series.length - 1]
    if (previous !== 0) {
      const change = ((latest - previous) / previous) * 100
      up = change >= 0
      let sign = ''
      if (change >= 0) {
        sign = '+'
      }
      changeText = `${sign}${change.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
    }
  }

  let changeClass = 'font-mono text-[10px] text-rose-400/80'
  if (up) {
    changeClass = 'font-mono text-[10px] text-neon/70'
  }

  return (
    <motion.button
      type="button"
      onClick={() => onOpen(opportunity.id)}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45 }}
      className={`glass relative flex flex-col justify-between overflow-hidden rounded-3xl p-4 text-left ${className}`}
    >
      <div className="flex items-start justify-between">
        <div className="relative flex h-10 max-w-[4.5rem] items-center justify-center truncate rounded-xl bg-neon/10 px-2 font-mono text-[11px] font-bold uppercase text-neon">
          {opportunity.protocol.name.slice(0, 4)}
          <Lock size={8} className="absolute -right-0.5 -top-0.5 rounded-full bg-ink p-[1px] text-neon/70" />
        </div>
        <div className={changeClass}>{changeText}</div>
      </div>

      <div className="-mx-1 my-3 flex min-h-0 flex-1 items-center">
        {series.length >= 2 && (
          <Sparkline
            series={series}
            up={up}
            width={130}
            height={chartHeight}
            fluid
            gradientId={opportunity.id}
          />
        )}
      </div>

      <div>
        <div className="truncate text-[14px] font-medium leading-tight">{opportunity.name}</div>
        <div className="mt-1.5 flex items-baseline justify-between gap-2">
          <span className="truncate font-mono text-[9px] uppercase tracking-wider text-white/30">
            {money(opportunity.tvl)} tvl
          </span>
          <span className="font-mono text-[13px] text-neon">
            {opportunity.totalApr === null ? 'Unavailable' : `${opportunity.totalApr.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`}
            {opportunity.rateType === 'apy' ? ' net APY' : ''}
          </span>
        </div>
      </div>
    </motion.button>
  )
}
