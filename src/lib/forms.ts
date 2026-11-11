import { z } from 'zod'
import { parseMoney } from '@/core'

/** A money text field that must parse to centavos. Converted on submit with parseMoney. */
export function moneyField(options: { allowZero?: boolean; message?: string } = {}) {
  const { allowZero = false, message = 'Enter an amount' } = options
  return z
    .string()
    .trim()
    .refine((v) => v !== '', message)
    .refine((v) => v === '' || parseMoney(v) !== null, 'Use numbers only, with up to 2 decimals')
    .refine((v) => allowZero || parseMoney(v) === null || (parseMoney(v) ?? 0) > 0, 'Enter an amount above ₱0')
}

/** Optional money field: empty means 0. */
export function optionalMoneyField() {
  return z
    .string()
    .trim()
    .refine((v) => v === '' || parseMoney(v) !== null, 'Use numbers only, with up to 2 decimals')
}

/** Day of month 1–31 kept as a string for Select inputs. */
export const dayField = z
  .string()
  .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 31, 'Pick a day')

export function toCentavos(value: string): number {
  return parseMoney(value) ?? 0
}

export const DAYS_OF_MONTH = Array.from({ length: 31 }, (_, i) => String(i + 1))
