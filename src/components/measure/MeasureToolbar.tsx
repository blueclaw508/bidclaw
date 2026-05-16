import { Hash, Hexagon, Minus, MousePointer2, PenTool } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MeasureToolMode } from '@/lib/types'

interface MeasureToolbarProps {
  tool: MeasureToolMode
  onChange: (next: MeasureToolMode) => void
  /**
   * Subset of tools that are functionally implemented. Buttons NOT in
   * this list still render (so the toolbar shape is final from day one)
   * but are disabled with a "coming in Phase X" tooltip.
   */
  enabledTools: readonly MeasureToolMode[]
}

interface ToolDef {
  id: MeasureToolMode
  label: string
  icon: typeof MousePointer2
  /** Used only in the disabled-state tooltip. */
  comingIn: string
}

// Order matches the order they ship in. Select first, then by phase.
const TOOLS: readonly ToolDef[] = [
  { id: 'select',   label: 'Select',   icon: MousePointer2, comingIn: 'Phase 2' },
  { id: 'line',     label: 'Line',     icon: Minus,         comingIn: 'Phase 4' },
  { id: 'count',    label: 'Count',    icon: Hash,          comingIn: 'Phase 5' },
  { id: 'area',     label: 'Area',     icon: Hexagon,       comingIn: 'Phase 6' },
  { id: 'freehand', label: 'Freehand', icon: PenTool,       comingIn: 'Phase 7' },
]

export function MeasureToolbar({
  tool,
  onChange,
  enabledTools,
}: MeasureToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label="Measure tools"
      className="inline-flex items-center gap-0.5 rounded-lg border border-brand-border bg-white p-1 shadow-sm"
    >
      {TOOLS.map((t) => {
        const enabled = enabledTools.includes(t.id)
        const active = t.id === tool && enabled
        const Icon = t.icon
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              if (enabled) onChange(t.id)
            }}
            disabled={!enabled}
            title={enabled ? t.label : `${t.label} — coming in ${t.comingIn}`}
            aria-pressed={active}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors',
              active &&
                'bg-brand-navy text-white shadow-sm hover:bg-brand-navy-dark',
              !active && enabled &&
                'text-brand-text hover:bg-brand-surface hover:text-brand-navy',
              !enabled &&
                'cursor-not-allowed text-brand-text-muted/50'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
