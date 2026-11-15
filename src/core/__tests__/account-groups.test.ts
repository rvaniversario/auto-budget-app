import { describe, expect, it } from 'vitest'
import { groupAccounts } from '../accountGroups'
import { pesos } from '../money'
import { account, card, tx } from './fixtures'

describe('account groups', () => {
  const cash = account({ name: 'Wallet', type: 'cash', openingBalance: pesos(2_000) })
  const bdo = account({ name: 'BDO Savings', openingBalance: pesos(30_000), createdAt: '2026-01-01T00:00:00.000Z' })
  const bdoCard = card({ name: 'BDO Visa', openingBalance: pesos(12_000) })
  const bpi = account({ name: 'BPI', openingBalance: pesos(5_000), createdAt: '2026-02-01T00:00:00.000Z' })
  const palawan = account({ name: 'PalawanPay', type: 'ewallet', openingBalance: pesos(1_500) })
  const carLoan = account({ name: 'Car loan', type: 'loan', openingBalance: pesos(200_000) })
  const mom = account({ name: 'Owed to Mom', type: 'debt', openingBalance: pesos(10_000) })
  const all = [mom, carLoan, palawan, bdoCard, bpi, bdo, cash]

  it('groups accounts by type in a fixed order, leaving out empty groups', () => {
    const { groups } = groupAccounts(all, [])
    expect(groups.map((g) => [g.name, g.rows.map((r) => r.account.name)])).toEqual([
      ['Cash', ['Wallet']],
      ['Deposit', ['BDO Savings', 'BPI']],
      ['E-wallet', ['PalawanPay']],
      ['Card', ['BDO Visa']],
      ['Loan', ['Car loan']],
      ['Debt', ['Owed to Mom']],
    ])
    expect(groupAccounts([bdo], []).groups.map((g) => g.name)).toEqual(['Deposit'])
  })

  it('totals each group, assets, liabilities and net worth', () => {
    const spend = tx({ accountId: bdoCard.id, amount: pesos(1_000) }) // card purchase adds to what is owed
    const o = groupAccounts(all, [spend])
    expect(o.groups.find((g) => g.type === 'bank')?.total).toBe(pesos(35_000))
    expect(o.groups.find((g) => g.type === 'credit_card')?.total).toBe(pesos(13_000))
    expect(o.assets).toBe(pesos(38_500))
    expect(o.liabilities).toBe(pesos(223_000))
    expect(o.netWorth).toBe(pesos(38_500 - 223_000))
  })

  it('ignores deleted accounts', () => {
    const gone = account({ name: 'Old', deletedAt: '2026-01-02T00:00:00.000Z' })
    expect(groupAccounts([gone], []).groups).toEqual([])
  })
})

describe('debt accounts', () => {
  it('count as money owed: payments reduce them, borrowing more adds to them', () => {
    const mom = account({ name: 'Owed to Mom', type: 'debt', openingBalance: pesos(10_000) })
    const bank = account({ name: 'BDO' })
    const paid = tx({ type: 'transfer', accountId: bank.id, toAccountId: mom.id, amount: pesos(2_000) })
    const borrowed = tx({ type: 'transfer', accountId: mom.id, toAccountId: bank.id, amount: pesos(500) })
    const o = groupAccounts([mom, bank], [paid, borrowed])
    expect(o.groups.find((g) => g.type === 'debt')?.total).toBe(pesos(8_500))
    expect(o.liabilities).toBe(pesos(8_500))
  })
})
