import { ArrowUpRight } from 'lucide-react'
import AsciiField from './AsciiField'

const LINKS = [
  { label: 'How it works', href: '#money' },
  { label: 'FAQ', href: '#faq' },
  { label: 'Docs', href: '#top' },
  { label: 'X', href: '#top' },
  { label: 'GitHub', href: '#top' },
]

export default function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-white/[0.07]">
      {/* one field behind the whole footer */}
      <div className="pointer-events-none absolute inset-0">
        <AsciiField fontSize={16} speed={0.4} opacity={0.8} />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/80 to-ink" />
      </div>

      <div className="shell relative py-16">
        <div className="flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/gizulogo.svg" alt="" className="h-6 w-auto" />
            <span className="text-[17px] font-medium tracking-tight">Gizu</span>
          </div>

          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex w-full max-w-[380px] items-center gap-2 rounded-full border border-white/10 p-1.5 pl-5"
          >
            <input
              type="email"
              placeholder="Email address"
              className="h-10 w-full min-w-0 bg-transparent text-[14px] outline-none placeholder:text-white/30"
            />
            <button className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-neon px-5 text-[13px] font-semibold text-ink">
              Join
              <ArrowUpRight size={15} strokeWidth={2.6} />
            </button>
          </form>
        </div>

        <div className="mt-12 flex flex-col gap-5 border-t border-white/[0.06] pt-7 sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex flex-wrap items-center gap-x-7 gap-y-3">
            {LINKS.map((l) => (
              <a key={l.label} href={l.href} className="text-[13.5px] text-white/50 hover:text-white">
                {l.label}
              </a>
            ))}
          </nav>

          <p className="text-[12.5px] text-white/30">
            Encryption does not remove investment risk.
          </p>
        </div>
      </div>
    </footer>
  )
}
