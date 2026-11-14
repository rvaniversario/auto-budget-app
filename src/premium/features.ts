import { ChartColumn, Landmark, Repeat, type LucideIcon } from 'lucide-react'

export type PremiumFeatureId = 'debtPlanner' | 'reports' | 'recurring'

export interface PremiumFeature {
  id: PremiumFeatureId
  name: string
  /** Navigation and page titles. */
  shortName: string
  /** One line for lists: the paywall and the status screen. */
  benefit: string
  /** Two or three sentences for the locked view. */
  description: string
  /** What the locked view lists under the preview. */
  highlights: string[]
  icon: LucideIcon
  /** Where the feature lives. */
  path: string
}

/**
 * The single list of Premium features. The paywall, locked views, Settings
 * and the status screen all read from here, so each benefit is written once.
 */
export const PREMIUM_FEATURES: readonly PremiumFeature[] = [
  {
    id: 'debtPlanner',
    name: 'Debt payoff planner',
    shortName: 'Debt planner',
    benefit: 'Plan every card and loan, and pick your debt-free date',
    description:
      'Put all your credit cards and loans in one plan. See the month each one is paid off, your debt-free date, and how much interest you save compared with paying only the minimums.',
    highlights: ['Highest interest first, smallest balance first, or your own order', 'Add extra payments like your 13th-month pay', 'Pick a debt-free date and see what it takes'],
    icon: Landmark,
    path: '/debt-planner',
  },
  {
    id: 'reports',
    name: 'Reports and trends',
    shortName: 'Reports',
    benefit: 'Compare months and spot categories that keep rising',
    description:
      'See how your spending in each category changed over your last 6 months, which ones keep rising, and how your card balance is coming down.',
    highlights: ['Month-to-month comparison by category', 'Yearly summary of income and spending', 'Export any report as PDF'],
    icon: ChartColumn,
    path: '/reports',
  },
  {
    id: 'recurring',
    name: 'Recurring transactions',
    shortName: 'Recurring',
    benefit: 'Rent and subscriptions log themselves',
    description:
      'Set up a transaction once and it is added for you on schedule: monthly, twice a month, weekly or every few weeks. Pause, edit or stop it any time.',
    highlights: ['Monthly, twice a month, weekly or every few weeks', 'Link it to a fixed bill', 'Created on every device without duplicates'],
    icon: Repeat,
    path: '/recurring',
  },
]

export function premiumFeature(id: PremiumFeatureId): PremiumFeature {
  return PREMIUM_FEATURES.find((f) => f.id === id)!
}

/** The registry with one feature moved to the top (the one the user came from). */
export function featuresFirst(id: PremiumFeatureId | null | undefined): PremiumFeature[] {
  if (!id) return [...PREMIUM_FEATURES]
  return [...PREMIUM_FEATURES].sort((a, b) => Number(b.id === id) - Number(a.id === id))
}
