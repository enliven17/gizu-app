import type { ProtocolSelection } from '../opportunities'

const filters: { id: ProtocolSelection; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'aave', label: 'Aave' },
  { id: 'morpho', label: 'Morpho' },
  { id: 'curvance', label: 'Curvance' },
]

export default function ProtocolFilters({
  value,
  onChange,
}: {
  value: ProtocolSelection
  onChange: (value: ProtocolSelection) => void
}) {
  return (
    <div className="flex gap-2 overflow-x-auto" role="group" aria-label="Filter by protocol">
      {filters.map((filter) => (
        <button
          key={filter.id}
          type="button"
          aria-pressed={value === filter.id}
          onClick={() => onChange(filter.id)}
          className={`shrink-0 rounded-full px-3.5 py-2 font-mono text-[11px] transition-colors ${
            value === filter.id
              ? 'bg-neon/15 text-neon'
              : 'glass-soft text-white/45 hover:text-white/75'
          }`}
        >
          {filter.label}
        </button>
      ))}
    </div>
  )
}
