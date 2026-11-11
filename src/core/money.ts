import type { Centavos } from './types'

export const PESO = 100

/** Whole pesos to centavos. */
export function pesos(amount: number): Centavos {
  return Math.round(amount * PESO)
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export interface FormatMoneyOptions {
  /** 'auto' shows cents only when they are not zero. */
  decimals?: 'auto' | 'always' | 'never'
  /** Prefix positive amounts with "+". */
  signed?: boolean
}

/**
 * Format centavos for display: ₱15,000 and ₱1,234.50.
 * Uses string arithmetic only, so no floating point is involved.
 */
export function formatMoney(value: Centavos, options: FormatMoneyOptions = {}): string {
  const { decimals = 'auto', signed = false } = options
  const negative = value < 0
  let abs = Math.abs(Math.trunc(value))

  if (decimals === 'never') {
    abs = Math.round(abs / PESO) * PESO
  }

  const whole = Math.floor(abs / PESO)
  const cents = abs % PESO
  const showCents = decimals === 'always' || (decimals === 'auto' && cents !== 0)
  const body = `₱${groupThousands(String(whole))}${showCents ? `.${String(cents).padStart(2, '0')}` : ''}`

  if (negative && abs !== 0) return `−${body}`
  if (signed && abs !== 0) return `+${body}`
  return body
}

/**
 * Parse user text such as "1,234.5" or "₱15,000" into centavos.
 * Returns null for anything that is not a valid non-negative amount
 * with at most two decimal places.
 */
export function parseMoney(input: string): Centavos | null {
  const cleaned = input.replace(/[₱,\s]/g, '')
  if (cleaned === '' || !/^\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '.') return null
  const [wholePart, centPart = ''] = cleaned.split('.')
  const whole = wholePart === '' ? 0 : Number.parseInt(wholePart, 10)
  const cents = Number.parseInt(centPart.padEnd(2, '0') || '0', 10)
  const result = whole * PESO + cents
  return Number.isSafeInteger(result) ? result : null
}

/** Centavos to a plain decimal string for inputs and CSV: 123450 → "1234.50", 1500000 → "15000". */
export function centavosToInput(value: Centavos): string {
  const negative = value < 0
  const abs = Math.abs(value)
  const whole = Math.floor(abs / PESO)
  const cents = abs % PESO
  const text = cents === 0 ? String(whole) : `${whole}.${String(cents).padStart(2, '0')}`
  return negative ? `-${text}` : text
}

/** Round up to the next multiple of `step` (e.g. ₱100 = 10000 centavos). */
export function roundUpTo(value: Centavos, step: Centavos): Centavos {
  if (step <= 0) return value
  return Math.ceil(value / step) * step
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function sum(values: readonly number[]): number {
  let total = 0
  for (const v of values) total += v
  return total
}

/** Apply a monthly percent rate to centavos, rounding to the nearest centavo. */
export function applyRate(value: Centavos, monthlyRatePercent: number): Centavos {
  return Math.round((value * monthlyRatePercent) / 100)
}
