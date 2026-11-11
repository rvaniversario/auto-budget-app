import { formatMoney, formatShortDate, payoffSchedule, type Centavos, type ISODate } from '@/core'
import { cn } from '@/lib/utils'

const MAX_ROWS = 12

/** Month-by-month table of payments, interest and what is still owed. */
export function PayoffSchedule({
  balance,
  payment,
  rate,
  firstDueDate,
  className,
}: {
  balance: Centavos
  payment: Centavos
  rate: number
  firstDueDate: ISODate
  className?: string
}) {
  const rows = payoffSchedule(balance, payment, rate, firstDueDate)
  if (rows.length === 0) return null
  const shown = rows.slice(0, MAX_ROWS)
  const neverClears = rows[rows.length - 1].owed > 0
  const money = (v: number) => formatMoney(v, { decimals: 'never' })
  const th = 'border-b border-border py-2 text-xs font-semibold text-muted-foreground'
  const td = 'border-b border-border py-2.5'

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-collapse">
        <caption className="pb-1 text-left text-[13px] font-bold">Payoff schedule</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(th, 'text-left')}>Payment</th>
            <th scope="col" className={cn(th, 'text-right')}>You pay</th>
            <th scope="col" className={cn(th, 'text-right')}>Interest</th>
            <th scope="col" className={cn(th, 'text-right')}>Still owed</th>
          </tr>
        </thead>
        <tbody className="money">
          {shown.map((r) => (
            <tr key={r.date}>
              <td className={cn(td, 'font-sans text-sm')}>{formatShortDate(r.date)}</td>
              <td className={cn(td, 'text-right text-[15px] font-medium')}>{money(r.payment)}</td>
              <td className={cn(td, 'text-right text-[15px] font-medium text-warning-text')}>{money(r.interest)}</td>
              <td className={cn(td, 'text-right text-[15px] font-semibold')}>{money(r.owed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(rows.length > MAX_ROWS || neverClears) && (
        <p className="pt-2 text-[13px] text-muted-foreground">
          {neverClears
            ? 'At this amount the balance is still not cleared after 10 years.'
            : `…and ${rows.length - MAX_ROWS} more month${rows.length - MAX_ROWS === 1 ? '' : 's'} until it is cleared.`}
        </p>
      )}
    </div>
  )
}
