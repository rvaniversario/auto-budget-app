import type { ReactNode } from 'react'
import { ChevronLeft, X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/utils'

/** Large heading used on tab screens: "Transactions", "Settings". */
export function TabHeader({ title, eyebrow, description, action }: { title: string; eyebrow?: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        {eyebrow && <p className="text-[13px] font-medium text-muted-foreground">{eyebrow}</p>}
        <h1 className="text-[26px] font-bold tracking-[-0.01em] md:text-[28px]">{title}</h1>
        {description && <p className="max-w-prose text-[13px] leading-[1.45] text-muted-foreground">{description}</p>}
      </div>
      {action}
    </header>
  )
}

/** Compact header with a back (or close) button for pushed screens. */
export function SubHeader({ title, close = false, to, action }: { title: string; close?: boolean; to?: string; action?: ReactNode }) {
  const navigate = useNavigate()
  const goBack = () => {
    if (to) navigate(to)
    else if (window.history.length > 1) navigate(-1)
    else navigate('/')
  }
  return (
    <header className="flex items-center justify-between gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={goBack}
          aria-label={close ? 'Close' : 'Back'}
          className="-ml-3 flex size-11 items-center justify-center rounded-lg text-foreground hover:bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {close ? <X className="size-6" /> : <ChevronLeft className="size-6" />}
        </button>
        <h1 className="font-sans text-[17px] font-bold md:font-heading md:text-[26px] md:tracking-[-0.01em]">{title}</h1>
      </div>
      {action ?? <span className="w-11" />}
    </header>
  )
}

export function Card16({ className, children, ...props }: React.ComponentProps<'section'>) {
  return (
    <section className={cn('rounded-card bg-card p-4 text-card-foreground', className)} {...props}>
      {children}
    </section>
  )
}

/** Uppercase section label: "SET ASIDE FIRST". */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn('mb-1 font-sans text-[13px] font-bold tracking-[0.04em] text-muted-foreground uppercase', className)}>
      {children}
    </h2>
  )
}

/** A full-width row button used in Settings. */
export function RowButton({
  label,
  value,
  description,
  onClick,
  danger,
  first,
  trailing,
}: {
  label: ReactNode
  value?: ReactNode
  description?: ReactNode
  onClick?: () => void
  danger?: boolean
  first?: boolean
  trailing?: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[52px] w-full items-center justify-between gap-3 rounded-md py-2 text-left text-[15px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        !first && 'border-t border-border',
        danger ? 'font-semibold text-danger-bar' : 'text-foreground',
      )}
    >
      <span className="flex flex-col gap-0.5">
        <span className="font-semibold">{label}</span>
        {description && <span className="text-[13px] font-normal text-muted-foreground">{description}</span>}
      </span>
      {trailing ?? (value !== undefined && <span className="shrink-0 text-right whitespace-nowrap text-muted-foreground">{value}</span>)}
    </button>
  )
}

/** Dashed "Add a bill" / "Add account" button. */
export function DashedButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[52px] w-full rounded-[14px] border border-dashed border-dash-line bg-transparent text-[15px] font-semibold text-foreground hover:bg-card/60 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </button>
  )
}

/** Small tag: "Near limit", "Over by ₱350", "One-time". */
export function Tag({ tone, children }: { tone: 'warning' | 'danger' | 'success'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-[10px] px-2 py-0.5 text-[11px] font-bold',
        tone === 'warning' && 'bg-warning-tint text-warning-text',
        tone === 'danger' && 'bg-danger-tint text-danger-text',
        tone === 'success' && 'bg-success-tint text-success-text',
      )}
    >
      {children}
    </span>
  )
}
