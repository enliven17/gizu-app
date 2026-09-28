import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Shell from './components/Shell'
import Onboarding from './components/Onboarding'
import Auth from './components/Auth'
import Home from './components/Home'
import Vaults from './components/Vaults'
import TokenCatalog from './components/TokenCatalog'
import Settings from './components/Settings'
import OpportunityDetail from './components/OpportunityDetail'
import SwapSheet from './components/SwapSheet'
import TransferSheet from './components/TransferSheet'
import Notifications from './components/Notifications'
import SubPage from './components/SubPage'
import RequestAccess from './components/RequestAccess'
import BottomNav from './components/BottomNav'
import useIsDesktop from './useIsDesktop'
import DesktopApp from './desktop/DesktopApp'

type Screen = 'onboard' | 'auth' | 'app' | 'vault' | 'notifications' | 'sub'
type Tab = 'home' | 'vaults' | 'swap' | 'settings'
type Trade = { side: 'buy' | 'sell'; name: string; ticker: string; price: number }

const slide = {
  initial: { opacity: 0, x: 24, filter: 'blur(6px)' },
  animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
}

export default function App() {
  const isDesktop = useIsDesktop()
  const [screen, setScreen] = useState<Screen>('onboard')
  const [tab, setTab] = useState<Tab>('home')
  const [opportunityId, setOpportunityId] = useState('')
  const [trade, setTrade] = useState<Trade | null>(null)
  const [transfer, setTransfer] = useState<'deposit' | 'withdraw' | null>(null)
  const [sub, setSub] = useState('')
  const [requesting, setRequesting] = useState(false)

  const openSub = (id: string) => {
    setSub(id)
    setScreen('sub')
  }

  const openOpportunity = (id: string) => {
    setOpportunityId(id)
    setScreen('vault')
  }

  const showNav = screen === 'app'

  if (isDesktop) return <DesktopApp />

  return (
    <Shell>
      <motion.div
          key={screen === 'app' ? tab : screen === 'sub' ? `sub-${sub}` : screen}
          {...slide}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {screen === 'onboard' && (
            <Onboarding onStart={() => setScreen('auth')} onRequestAccess={() => setRequesting(true)} />
          )}
          {screen === 'auth' && <Auth onBack={() => setScreen('onboard')} onDone={() => setScreen('app')} />}
          {screen === 'app' && tab === 'home' && (
            <Home
              onOpenOpportunity={openOpportunity}
              onNotifications={() => setScreen('notifications')}
              onSeeAllVaults={() => setTab('vaults')}
              onTransfer={setTransfer}
              onActivity={() => openSub('activity')}
            />
          )}
          {screen === 'app' && tab === 'vaults' && <Vaults onOpenOpportunity={openOpportunity} />}
          {screen === 'app' && tab === 'swap' && <TokenCatalog />}
          {screen === 'app' && tab === 'settings' && (
            <Settings
              onOpen={openSub}
              onDisconnect={() => {
                setTab('home')
                setScreen('onboard')
              }}
            />
          )}
          {screen === 'notifications' && <Notifications onBack={() => setScreen('app')} />}
          {screen === 'sub' && <SubPage id={sub} onBack={() => setScreen('app')} />}
          {screen === 'vault' && opportunityId.length > 0 && (
            <OpportunityDetail
              id={opportunityId}
              onBack={() => setScreen('app')}
              onTrade={(side, asset) =>
                setTrade({ side, name: asset.name, ticker: asset.ticker, price: asset.price })
              }
            />
          )}
        </motion.div>

      {showNav && <BottomNav active={tab} onChange={(id) => setTab(id as Tab)} />}

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
        {transfer && <TransferSheet mode={transfer} onClose={() => setTransfer(null)} />}
        {requesting && <RequestAccess onClose={() => setRequesting(false)} />}
      </AnimatePresence>
    </Shell>
  )
}
