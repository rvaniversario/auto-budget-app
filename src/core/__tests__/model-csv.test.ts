import { describe, expect, it } from 'vitest'
import { transactionsToCSV } from '../csv'
import { computeMonthModel, overridesForPeriod } from '../model'
import { pesos } from '../money'
import { BUFFER_KEY } from '../types'
import { account, bill, card, category, override, settings, snapshot, tx } from './fixtures'

const TODAY = '2026-11-11' // period Oct 30 – Nov 29, previous Sep 30 – Oct 29

/** Income logged on payday, the first day of the current budget month. */
const pay = (amount: number) => tx({ accountId: 'bank', type: 'income', amount: pesos(amount), date: '2026-10-30' })

function world() {
  const bank = account({ name: 'BDO', openingBalance: pesos(10_000) })
  const visa = card({ openingBalance: pesos(50_000), minimumDue: pesos(2_500), monthlyInterestRate: 3 })
  const groceries = category({ name: 'Groceries', sortOrder: 0 })
  const food = category({ name: 'Food', sortOrder: 1 })
  const shopping = category({ name: 'Shopping', kind: 'optional', sortOrder: 2 })
  const rent = bill({ name: 'Rent', amount: pesos(15_000) })
  const internet = bill({ name: 'Internet', amount: pesos(1_500) })
  // Last budget month's spending: Groceries 6,000, Food 4,000, Shopping 2,000.
  const history = [
    tx({ accountId: bank.id, categoryId: groceries.id, amount: pesos(6_000), date: '2026-10-05' }),
    tx({ accountId: bank.id, categoryId: food.id, amount: pesos(4_000), date: '2026-10-06' }),
    tx({ accountId: bank.id, categoryId: shopping.id, amount: pesos(2_000), date: '2026-10-07' }),
  ]
  return { bank, visa, groceries, food, shopping, rent, internet, history }
}

describe('computeMonthModel', () => {
  it('new user with no transactions: categories start at 0, nothing spent', () => {
    const w = world()
    const m = computeMonthModel(
      snapshot({
        accounts: [w.bank, w.visa],
        categories: [w.groceries, w.food, w.shopping],
        fixedBills: [w.rent, w.internet],
        transactions: [pay(45_000)],
      }),
      TODAY,
    )
    expect(m.period.start).toBe('2026-10-30')
    expect(m.isEstimate).toBe(true)
    expect(m.hasHistory).toBe(false)
    expect(m.spentSoFar).toBe(0)
    expect(m.categoryRows.map((r) => r.budget)).toEqual([0, 0, 0])
    // 45,000 − 16,500 − 3,000 = 25,500
    expect(m.safe.amount).toBe(pesos(25_500))
    expect(m.plan.unassigned).toBe(0)
    expect(m.overspent).toEqual([])
    expect(m.ifYouPay.unpaidBalance).toBe(pesos(24_500))
    expect(m.ifYouPay.nextMonthInterest).toBe(pesos(735))
    expect(m.cards[0].nextDueDate).toBe('2026-11-25')
  })

  it('Safe to pay switched off: nothing set aside for the card', () => {
    const w = world()
    const m = computeMonthModel(
      snapshot({
        settings: settings({ safePaymentEnabled: false }),
        accounts: [w.bank, w.visa],
        categories: [w.groceries],
        fixedBills: [w.rent],
        transactions: [pay(45_000)],
      }),
      TODAY,
    )
    expect(m.safeEnabled).toBe(false)
    expect(m.cards).toHaveLength(1)
    expect(m.cards[0].allocation.amount).toBe(0)
    expect(m.safe.amount).toBe(0)
    expect(m.safe.belowMinimum).toBe(false)
    expect(m.plan.setAsideFirst.some((l) => l.kind === 'card_payment')).toBe(false)
    // 45,000 − 15,000 − 3,000
    expect(m.plan.unassigned).toBe(pesos(27_000))
  })

  it('Safe to pay is off when the setting is missing', () => {
    const s = { ...settings() }
    delete s.safePaymentEnabled
    expect(computeMonthModel(snapshot({ settings: s }), TODAY).safeEnabled).toBe(false)
  })

  it('left after bills: remaining minus bills not yet paid, with lump card payments subtracted too', () => {
    const w = world()
    const bpi1 = bill({ name: 'BPI CC', amount: pesos(2_207.33), dueDay: 15 })
    const bpi2 = bill({ name: 'BPI CC', amount: pesos(2_959.34), dueDay: 15 })
    const internet = bill({ name: 'Internet', amount: pesos(1_558), dueDay: 5 })
    const rent = bill({ name: 'Rent', amount: pesos(4_500), dueDay: 8 })
    const m = computeMonthModel(
      snapshot({
        accounts: [w.bank, w.visa],
        fixedBills: [bpi1, bpi2, internet, rent],
        transactions: [
          pay(40_000),
          // Internet logged as paid.
          tx({ accountId: w.bank.id, amount: pesos(1_558), fixedBillId: internet.id, categoryId: null, date: '2026-11-05' }),
          // A lump 10,000 payment to the card: not tied to any bill.
          tx({ accountId: w.bank.id, type: 'transfer', toAccountId: w.visa.id, amount: pesos(10_000), date: '2026-11-10' }),
        ],
      }),
      TODAY,
    )
    // 40,000 − 1,558 spent − 10,000 paid to the card
    expect(m.remaining).toBe(pesos(28_442))
    // Both BPI bills and rent are still unpaid; the card payment doesn't mark them paid.
    expect(m.unpaidBills).toBe(pesos(2_207.33 + 2_959.34 + 4_500))
    expect(m.leftAfterBills).toBe(m.remaining - m.unpaidBills)
    // Nov 11 is day 13 of 31, so 19 days are left including today.
    expect(m.daysLeft).toBe(19)
    expect(m.perDayAfterBills).toBe(Math.floor(m.leftAfterBills / 19))
  })

  describe('carry-over', () => {
    function carryWorld(carryOverEnabled?: boolean) {
      const w = world()
      const loan = account({ name: 'Car loan', type: 'loan', openingBalance: pesos(100_000) })
      const transactions = [
        // Earlier budget months: 40,000 in, 1,000 + 30,000 spent, 5,000 paid to the card, 1,500 to a loan, 50 transfer fee.
        tx({ accountId: w.bank.id, type: 'income', amount: pesos(40_000), date: '2026-09-30' }),
        tx({ accountId: w.bank.id, categoryId: w.groceries.id, amount: pesos(1_000), date: '2026-08-01' }),
        tx({ accountId: w.bank.id, categoryId: w.food.id, amount: pesos(30_000), date: '2026-10-05' }),
        tx({ accountId: w.bank.id, type: 'transfer', toAccountId: w.visa.id, amount: pesos(5_000), date: '2026-10-10' }),
        tx({ accountId: w.bank.id, type: 'transfer', toAccountId: 'other-bank', amount: pesos(2_000), fee: pesos(50), date: '2026-10-11' }),
        tx({ accountId: w.bank.id, type: 'transfer', toAccountId: loan.id, amount: pesos(1_500), date: '2026-10-15' }),
        // Deleted: ignored.
        tx({ accountId: w.bank.id, type: 'income', amount: pesos(9_999), date: '2026-10-12', deletedAt: '2026-10-13T00:00:00Z' }),
        // This month.
        pay(20_000),
        tx({ accountId: w.bank.id, categoryId: w.food.id, amount: pesos(500), date: '2026-11-02' }),
      ]
      return computeMonthModel(
        snapshot({
          settings: settings({ safePaymentEnabled: false, ...(carryOverEnabled === undefined ? {} : { carryOverEnabled }) }),
          accounts: [w.bank, w.visa, loan],
          categories: [w.groceries, w.food],
          transactions,
        }),
        TODAY,
      )
    }

    it('is off by default', () => {
      const m = carryWorld()
      expect(m.carryOverEnabled).toBe(false)
      expect(m.carryOver).toBe(0)
      expect(m.available).toBe(pesos(20_000))
      expect(m.remaining).toBe(pesos(19_500))
    })

    it('adds what earlier months left to this month', () => {
      const m = carryWorld(true)
      // 40,000 − 1,000 − 30,000 − 5,000 − 1,500 − 50 = 2,450
      expect(m.carryOver).toBe(pesos(2_450))
      expect(m.income).toBe(pesos(20_000))
      expect(m.available).toBe(pesos(22_450))
      expect(m.plan.salary).toBe(pesos(22_450))
      expect(m.safeInput.salary).toBe(pesos(22_450))
      expect(m.remaining).toBe(pesos(21_950))
    })

    it('Remaining takes off loan payments this month, like the carry-over does', () => {
      const w = world()
      const loan = account({ name: 'Car loan', type: 'loan', openingBalance: pesos(100_000) })
      const m = computeMonthModel(
        snapshot({
          accounts: [w.bank, w.visa, loan],
          transactions: [
            pay(20_000),
            tx({ accountId: w.bank.id, type: 'transfer', toAccountId: w.visa.id, amount: pesos(3_000), date: '2026-11-03' }),
            tx({ accountId: w.bank.id, type: 'transfer', toAccountId: loan.id, amount: pesos(1_500), date: '2026-11-04' }),
            tx({ accountId: w.bank.id, type: 'transfer', toAccountId: 'savings', amount: pesos(2_000), date: '2026-11-05' }),
          ],
        }),
        TODAY,
      )
      // 20,000 − 3,000 (card) − 1,500 (loan); the move to savings is not a payment.
      expect(m.remaining).toBe(pesos(15_500))
      expect(m.paidToCardsThisPeriod).toBe(pesos(3_000))
    })

    it('carries an overspend as a negative amount', () => {
      const w = world()
      const m = computeMonthModel(
        snapshot({
          settings: settings({ carryOverEnabled: true }),
          accounts: [w.bank],
          categories: [w.groceries],
          transactions: [tx({ accountId: w.bank.id, categoryId: w.groceries.id, amount: pesos(1_200), date: '2026-10-20' }), pay(10_000)],
        }),
        TODAY,
      )
      expect(m.carryOver).toBe(-pesos(1_200))
      expect(m.available).toBe(pesos(8_800))
    })
  })

  it('no data at all (no card, no categories) still works', () => {
    const m = computeMonthModel(snapshot(), TODAY)
    expect(m.safe.amount).toBe(0)
    expect(m.safe.belowMinimum).toBe(false)
    expect(m.cards).toEqual([])
    expect(m.shortfallOptions).toEqual([])
    // No income logged yet, so only the buffer is planned and the plan is over by it.
    expect(m.income).toBe(0)
    expect(m.plan.unassigned).toBe(-pesos(3_000))
  })

  it('uses last month real spending once it exists, and a card payment never counts as spending', () => {
    const w = world()
    const transactions = [
      pay(60_000),
      tx({ accountId: w.bank.id, categoryId: w.groceries.id, amount: pesos(5_430), date: '2026-10-10' }),
      tx({ accountId: w.visa.id, categoryId: w.shopping.id, amount: pesos(1_250), date: '2026-10-12' }),
      // Card payment last month: must not inflate any baseline.
      tx({ accountId: w.bank.id, type: 'transfer', toAccountId: w.visa.id, amount: pesos(20_000), date: '2026-10-15' }),
    ]
    const m = computeMonthModel(
      snapshot({
        accounts: [w.bank, w.visa],
        categories: [w.groceries, w.food, w.shopping],
        fixedBills: [w.rent],
        transactions,
      }),
      TODAY,
    )
    expect(m.isEstimate).toBe(false)
    const byName = Object.fromEntries(m.categoryRows.map((r) => [r.name, r]))
    expect(byName.Groceries.budget).toBe(pesos(5_500))
    expect(byName.Food.budget).toBe(0)
    expect(byName.Shopping.budget).toBe(pesos(1_300))
    // Card: 50,000 + 1,250 − 20,000 = 31,250
    expect(m.cards[0].balance).toBe(pesos(31_250))
    // 60,000 − 15,000 − 5,500 − 1,300 − 3,000 = 35,200 → clamp to balance (pay in full)
    expect(m.safe.amount).toBe(pesos(31_250))
    expect(m.safe.paysInFull).toBe(true)
    expect(m.plan.unassigned).toBe(pesos(35_200 - 31_250))
  })

  it('overspent category produces an alert with a move suggestion', () => {
    const w = world()
    const transactions = [
      ...w.history,
      tx({ accountId: w.bank.id, categoryId: w.food.id, amount: pesos(4_350), date: '2026-11-05' }),
      tx({ accountId: w.bank.id, categoryId: w.shopping.id, amount: pesos(100), date: '2026-11-05' }),
    ]
    const m = computeMonthModel(
      snapshot({
        accounts: [w.bank, w.visa],
        categories: [w.groceries, w.food, w.shopping],
        transactions,
      }),
      TODAY,
    )
    expect(m.isEstimate).toBe(false)
    expect(m.overspent).toHaveLength(1)
    expect(m.overspent[0].row.name).toBe('Food')
    expect(m.overspent[0].row.overBy).toBe(pesos(350))
    expect(m.overspent[0].fix).toEqual({ type: 'move', fromCategoryId: w.shopping.id, fromName: 'Shopping', amount: pesos(350) })
  })

  it('a category with no budget (0) is never over, but its spending still counts', () => {
    const w = world()
    const other = category({ name: 'Other', kind: 'optional', sortOrder: 3 })
    const m = computeMonthModel(
      snapshot({
        accounts: [w.bank],
        categories: [w.groceries, other],
        transactions: [tx({ accountId: w.bank.id, categoryId: other.id, amount: pesos(7_010), date: '2026-11-05' })],
      }),
      TODAY,
    )
    const row = m.categoryRows.find((r) => r.name === 'Other')!
    expect(row).toMatchObject({ budget: 0, spent: pesos(7_010), status: 'ok', overBy: 0, percent: 0 })
    expect(m.overspent).toEqual([])
    expect(m.spentSoFar).toBe(pesos(7_010))
  })

  it('salary lower than bills: safe 0, below minimum, with suggestions', () => {
    const w = world()
    const m = computeMonthModel(
      snapshot({
        accounts: [w.bank, w.visa],
        categories: [w.groceries, w.shopping],
        fixedBills: [w.rent],
        transactions: [...w.history, pay(14_000)],
      }),
      TODAY,
    )
    expect(m.safe.amount).toBe(0)
    expect(m.safe.belowMinimum).toBe(true)
    expect(m.safe.shortfall).toBe(pesos(2_500))
    expect(m.shortfallOptions.map((o) => o.id)).toEqual(['buffer', 'optional', 'split'])
  })

  it('payments made this month are tracked and the plan uses the start-of-month balance', () => {
    const w = world()
    const transactions = [pay(60_000), tx({ accountId: w.bank.id, type: 'transfer', toAccountId: w.visa.id, amount: pesos(5_000), date: '2026-11-02' })]
    const m = computeMonthModel(
      snapshot({ accounts: [w.bank, w.visa], categories: [w.groceries], transactions }),
      TODAY,
    )
    expect(m.cards[0].balance).toBe(pesos(45_000))
    expect(m.cards[0].planBalance).toBe(pesos(50_000))
    expect(m.paidToCardsThisPeriod).toBe(pesos(5_000))
    expect(m.leftToPay).toBe(m.safe.amount - pesos(5_000))
    expect(m.spentSoFar).toBe(0)
  })

  it('overrides change budgets and the buffer for the current month only', () => {
    const w = world()
    const m = computeMonthModel(
      snapshot({
        accounts: [w.visa],
        categories: [w.groceries, w.shopping],
        transactions: w.history,
        overrides: [
          override('2026-10-30', w.shopping.id, pesos(500)),
          override('2026-10-30', BUFFER_KEY, pesos(1_000)),
          override('2026-09-30', w.groceries.id, pesos(1)),
        ],
      }),
      TODAY,
    )
    expect(m.buffer).toBe(pesos(1_000))
    expect(m.bufferIsOverride).toBe(true)
    expect(m.categoryRows.find((r) => r.name === 'Shopping')?.budget).toBe(pesos(500))
    expect(m.categoryRows.find((r) => r.name === 'Groceries')?.budget).toBe(pesos(6_000))
  })

  it('soft-deleted records are ignored everywhere', () => {
    const w = world()
    const deleted = '2026-11-06T00:00:00Z'
    const m = computeMonthModel(
      snapshot({
        accounts: [w.bank, w.visa, card({ name: 'Old card', deletedAt: deleted })],
        categories: [w.groceries, category({ name: 'Gone', deletedAt: deleted })],
        fixedBills: [w.rent, bill({ name: 'Old bill', deletedAt: deleted })],
        transactions: [...w.history, tx({ accountId: w.bank.id, categoryId: w.groceries.id, amount: pesos(999), date: '2026-11-05', deletedAt: deleted })],
        overrides: [{ ...override('2026-10-30', w.groceries.id, pesos(1)), deletedAt: deleted }],
      }),
      TODAY,
    )
    expect(m.cards).toHaveLength(1)
    expect(m.categoryRows.map((r) => r.name)).toEqual(['Groceries'])
    expect(m.fixedBillsTotal).toBe(pesos(15_000))
    expect(m.spentSoFar).toBe(0)
    expect(m.categoryRows[0].budget).toBe(pesos(6_000))
  })

  it('overridesForPeriod: latest edit wins', () => {
    const map = overridesForPeriod(
      [override('2026-10-30', 'x', 1, '2026-11-02T00:00:00Z'), override('2026-10-30', 'x', 2, '2026-11-01T00:00:00Z')],
      '2026-10-30',
    )
    expect(map.get('x')).toBe(1)
  })
})

describe('transactionsToCSV', () => {
  it('writes a header and escapes values', () => {
    const bank = account({ name: 'BDO' })
    const g = category({ name: 'Groceries' })
    const csv = transactionsToCSV(
      [
        tx({ accountId: bank.id, categoryId: g.id, amount: 123_450, date: '2026-11-02', note: 'eggs, "fresh"' }),
        tx({ accountId: bank.id, amount: 100, date: '2026-11-01', note: '=cmd()' }),
        tx({ accountId: bank.id, amount: 100, date: '2026-11-01', deletedAt: '2026-11-03T00:00:00Z' }),
      ],
      { categories: [g], accounts: [bank], fixedBills: [] },
    )
    const lines = csv.trim().split('\r\n')
    expect(lines[0]).toBe('date,type,amount,fee,category,bill,account,to_account,note,one_time')
    expect(lines).toHaveLength(3)
    expect(lines[1]).toBe("2026-11-01,expense,1,,,,BDO,,'=cmd(),no")
    expect(lines[2]).toBe('2026-11-02,expense,1234.50,,Groceries,,BDO,,"eggs, ""fresh""",no')
  })
})
