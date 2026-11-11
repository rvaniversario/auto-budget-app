import type { AppSnapshot, Transaction } from '@/core'

export interface TransactionDescription {
  /** Note, or a sensible fallback ("Card payment", the bill or category name). */
  title: string
  /** Category column: category name, "Bills", "Income" or "Transfer". */
  category: string
  /** Account column: "Bank", or "Bank to Visa" for transfers. */
  account: string
  /** One-line summary for compact rows: "Food · Bank". */
  meta: string
}

/** Builds a describer bound to the current records (lookups are created once). */
export function makeDescriber(snapshot: Pick<AppSnapshot, 'accounts' | 'categories' | 'fixedBills'>) {
  const accounts = new Map(snapshot.accounts.map((a) => [a.id, a]))
  const categories = new Map(snapshot.categories.map((c) => [c.id, c.name]))
  const bills = new Map(snapshot.fixedBills.map((b) => [b.id, b.name]))

  return (t: Transaction): TransactionDescription => {
    const from = accounts.get(t.accountId)?.name ?? 'Account'
    if (t.type === 'income') {
      return { title: t.note || 'Income', category: 'Income', account: from, meta: `Income · ${from}` }
    }
    if (t.type === 'transfer') {
      const toAccount = t.toAccountId ? accounts.get(t.toAccountId) : undefined
      const to = toAccount?.name ?? 'Account'
      const isCardPayment = toAccount?.type === 'credit_card'
      const account = `${from} to ${to}`
      return {
        title: t.note || (isCardPayment ? 'Card payment' : 'Transfer'),
        category: isCardPayment ? 'Card payment' : 'Transfer',
        account,
        meta: account,
      }
    }
    const category = t.categoryId ? (categories.get(t.categoryId) ?? 'Category') : 'Bills'
    const bill = t.fixedBillId ? bills.get(t.fixedBillId) : undefined
    return { title: t.note || bill || category, category, account: from, meta: `${category} · ${from}` }
  }
}

/** Amount prefix: "+ " for income, "− " for expenses, nothing for transfers. */
export function amountSign(t: Transaction): string {
  return t.type === 'income' ? '+ ' : t.type === 'expense' ? '− ' : ''
}
