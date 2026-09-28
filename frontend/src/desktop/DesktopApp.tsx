import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import DesktopEntry from './DesktopEntry'
import DesktopShell from './DesktopShell'
import DesktopHome from './DesktopHome'
import DesktopVaults from './DesktopVaults'
import TokenCatalog from '../components/TokenCatalog'
import DesktopSettings from './DesktopSettings'
import OpportunityDetail from '../components/OpportunityDetail'
import SwapSheet from '../components/SwapSheet'
import SubPage from '../components/SubPage'
import TransferSheet from '../components/TransferSheet'

type Screen = 'entry' | 'app' | 'vault' | 'sub'
type Tab = 'home' | 'vaults' | 'swap' | 'settings'
type Trade = { side: 'buy' | 'sell'; name: string; ticker: string; price: number }

const fade = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
}

export default function DesktopApp() {
  const [screen, setScreen] = useState<Screen>('entry')
  const [tab, setTab] = useState<Tab>('home')
  const [opportunityId, setOpportunityId] = useState('')
  const [trade, setTrade] = useState<Trade | null>(null)
  const [transfer, setTransfer] = useState<'deposit' | 'withdraw' | null>(null)
  const [sub, setSub] = useState('')

  const openOpportunity = (id: string) => {
    setOpportunityId(id)
    setScreen('vault')
  }

  const openSub = (id: string) => {
    setSub(id)
    setScreen('sub')
  }

  if (screen === 'entry') return <DesktopEntry onDone={() => setScreen('app')} />

  return (
    <DesktopShell
      tab={screen === 'app' ? tab : ''}
      onTab={(id) => {
        setTab(id as Tab)
        setScreen('app')
      }}
      onDisconnect={() => {
        setTab('home')
        setScreen('entry')
      }}
    >
      <motion.div
          key={screen === 'app' ? tab : screen === 'sub' ? `sub-${sub}` : screen}
          {...fade}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {screen === 'app' && tab === 'home' && (
            <DesktopHome
              onOpenOpportunity={openOpportunity}
              onTransfer={setTransfer}
              onActivity={() => openSub('activity')}
              onSeeAllVaults={() => setTab('vaults')}
            />
          )}
          {screen === 'app' && tab === 'vaults' && (
            <DesktopVaults onOpenOpportunity={openOpportunity} />
          )}
          {screen === 'app' && tab === 'swap' && <TokenCatalog />}
          {screen === 'app' && tab === 'settings' && <DesktopSettings onOpen={openSub} />}
          {screen === 'vault' && opportunityId.length > 0 && (
            <div className="mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col">
              <OpportunityDetail
                id={opportunityId}
                onBack={() => setScreen('app')}
                onTrade={(side, asset) =>
                  setTrade({ side, name: asset.name, ticker: asset.ticker, price: asset.price })
                }
              />
            </div>
          )}
          {screen === 'sub' && (
            <div className="mx-auto flex min-h-0 w-full max-w-[760px] flex-1 flex-col px-12">
              <SubPage id={sub} onBack={() => setScreen('app')} />
            </div>
          )}
        </motion.div>

      <AnimatePresence>
        {trade && (
          <SwapSheet
            name={trade.name}
            ticker={trade.ticker}
            price={trade.price}
            side={trade.side}
            onClose={() => setTrade(null)}
          />
        )}
        {transfer && (
          <TransferSheet mode={transfer} variant="modal" onClose={() => setTransfer(null)} />
        )}
      </AnimatePresence>
    </DesktopShell>
  )
}
