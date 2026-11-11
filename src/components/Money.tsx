import { formatMoney, type FormatMoneyOptions } from '@/core'
import { cn } from '@/lib/utils'

interface MoneyProps extends FormatMoneyOptions {
  value: number
  className?: string
}

/** A peso amount in the money typeface with tabular figures. */
export function Money({ value, className, ...options }: MoneyProps) {
  return <span className={cn('money', className)}>{formatMoney(value, options)}</span>
}
