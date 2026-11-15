import { getAccountBalance } from './ledger'
import { sum } from './money'
import { alive, isDebtAccount, type Account, type AccountType, type Centavos, type Transaction } from './types'

/** The Accounts screen groups accounts by type, in this order. Labels match the type chips in the account form. */
export const ACCOUNT_GROUPS: readonly AccountType[] = ['cash', 'bank', 'ewallet', 'credit_card', 'loan', 'debt']

export const GROUP_LABEL: Record<AccountType, string> = {
  cash: 'Cash',
  bank: 'Deposit',
  ewallet: 'E-wallet',
  credit_card: 'Card',
  loan: 'Loan',
  debt: 'Debt',
}

export interface AccountRow {
  account: Account
  /** Money in it, or for a card or loan the amount owed. */
  balance: Centavos
}

export interface AccountGroup {
  type: AccountType
  name: string
  rows: AccountRow[]
  /** Money held (cash, deposit, e-wallet), or owed (cards, loans, debts). */
  total: Centavos
}

export interface AccountsOverview {
  groups: AccountGroup[]
  /** Money held in cash, deposit and e-wallet accounts. */
  assets: Centavos
  /** Owed on cards, loans and debts. */
  liabilities: Centavos
  /** What you have minus what you owe. */
  netWorth: Centavos
}

/** Accounts grouped by type with subtotals, oldest account first in each group. Empty groups are left out. */
export function groupAccounts(accounts: readonly Account[], transactions: readonly Transaction[]): AccountsOverview {
  const rows: AccountRow[] = alive(accounts)
    .map((account) => ({ account, balance: getAccountBalance(account, transactions) }))
    .sort((a, b) => a.account.createdAt.localeCompare(b.account.createdAt))

  const groups = ACCOUNT_GROUPS.map((type) => {
    const list = rows.filter((r) => r.account.type === type)
    return { type, name: GROUP_LABEL[type], rows: list, total: sum(list.map((r) => r.balance)) }
  }).filter((g) => g.rows.length > 0)

  const assets = sum(groups.filter((g) => !isDebtAccount(g.type)).map((g) => g.total))
  const liabilities = sum(groups.filter((g) => isDebtAccount(g.type)).map((g) => g.total))
  return { groups, assets, liabilities, netWorth: assets - liabilities }
}
