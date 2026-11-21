import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Text input for peso amounts. Keeps the raw string; parse with parseMoney on submit. */
export function MoneyInput({ className, large, ...props }: React.ComponentProps<'input'> & { large?: boolean }) {
  return (
    <Input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder="0"
      className={cn(
        'h-[52px] rounded-lg bg-card px-3.5 text-base',
        large && 'h-[60px] font-heading text-2xl font-semibold',
        className,
      )}
      {...props}
    />
  )
}

export function TextInput({ className, ...props }: React.ComponentProps<'input'>) {
  return <Input className={cn('h-[52px] rounded-lg bg-card px-3.5 text-base', className)} {...props} />
}

export interface ChoiceOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  ariaLabel?: string
}

/**
 * A group of toggle buttons (aria-pressed). `shape="pill"` for category chips,
 * `"rect"` for account choices. Selected = primary fill.
 */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  label,
  shape = 'rect',
  columns = 3,
  scroll = false,
  className,
}: {
  options: ChoiceOption<T>[]
  value: T | null
  onChange: (value: T) => void
  label: string
  shape?: 'pill' | 'rect'
  columns?: number
  scroll?: boolean
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(scroll ? 'no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4' : 'grid gap-2', className)}
      style={scroll ? undefined : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            aria-label={o.ariaLabel}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-11 min-w-0 truncate border px-3 text-sm font-semibold transition-colors disabled:opacity-50 outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              shape === 'pill' ? 'rounded-full' : 'rounded-lg',
              scroll && 'flex-none px-4',
              on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card text-foreground hover:bg-muted',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Segmented control (Expense / Income / Transfer). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ChoiceOption<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="grid gap-1 rounded-[14px] bg-border p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-11 rounded-[10px] text-[13px] font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              on ? 'bg-segment-on text-foreground shadow-sm' : 'text-muted-foreground',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Amount shown as a tappable bordered button (Budget plan, bills list). */
export function AmountButton({ className, children, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'h-11 min-w-24 shrink-0 rounded-lg border border-input bg-card px-3.5 font-heading text-base font-semibold text-foreground tabular-nums hover:bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
