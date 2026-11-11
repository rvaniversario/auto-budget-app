import { describe, expect, it } from 'vitest'
import { applyRate, centavosToInput, clamp, formatMoney, parseMoney, pesos, roundUpTo, sum } from '../money'

describe('formatMoney', () => {
  it('formats whole pesos without decimals', () => {
    expect(formatMoney(pesos(15_000))).toBe('₱15,000')
    expect(formatMoney(0)).toBe('₱0')
    expect(formatMoney(pesos(1_000_000))).toBe('₱1,000,000')
  })

  it('shows cents when present', () => {
    expect(formatMoney(123_450)).toBe('₱1,234.50')
    expect(formatMoney(5)).toBe('₱0.05')
  })

  it('handles negatives and signs', () => {
    expect(formatMoney(-pesos(350))).toBe('−₱350')
    expect(formatMoney(pesos(350), { signed: true })).toBe('+₱350')
    expect(formatMoney(0, { signed: true })).toBe('₱0')
  })

  it('supports always / never decimals', () => {
    expect(formatMoney(pesos(10), { decimals: 'always' })).toBe('₱10.00')
    expect(formatMoney(123_450, { decimals: 'never' })).toBe('₱1,235')
  })
})

describe('parseMoney', () => {
  it('parses plain and formatted amounts to centavos', () => {
    expect(parseMoney('15000')).toBe(1_500_000)
    expect(parseMoney('₱1,234.50')).toBe(123_450)
    expect(parseMoney('1234.5')).toBe(123_450)
    expect(parseMoney('0.05')).toBe(5)
    expect(parseMoney('.5')).toBe(50)
    expect(parseMoney('12.')).toBe(1_200)
  })

  it('avoids floating point error', () => {
    expect(parseMoney('0.29')).toBe(29) // 0.29 * 100 = 28.999999999999996 in floats
    expect(parseMoney('1.15')).toBe(115)
  })

  it('rejects invalid input', () => {
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('.')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('1.234')).toBeNull()
    expect(parseMoney('-5')).toBeNull()
  })
})

describe('helpers', () => {
  it('centavosToInput', () => {
    expect(centavosToInput(1_500_000)).toBe('15000')
    expect(centavosToInput(123_450)).toBe('1234.50')
    expect(centavosToInput(-50)).toBe('-0.50')
  })

  it('roundUpTo rounds up to the next step', () => {
    expect(roundUpTo(pesos(4_201), pesos(100))).toBe(pesos(4_300))
    expect(roundUpTo(pesos(4_200), pesos(100))).toBe(pesos(4_200))
    expect(roundUpTo(1, pesos(100))).toBe(pesos(100))
    expect(roundUpTo(0, pesos(100))).toBe(0)
  })

  it('clamp, sum, applyRate', () => {
    expect(clamp(5, 0, 3)).toBe(3)
    expect(clamp(-5, 0, 3)).toBe(0)
    expect(sum([1, 2, 3])).toBe(6)
    expect(applyRate(pesos(35_000), 3)).toBe(pesos(1_050))
    expect(applyRate(333, 3.5)).toBe(12) // 11.655 → 12
  })
})
