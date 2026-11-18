/**
 * What's new, newest first. When releasing: bump "version" in package.json and
 * add an entry here with the same version (releases.test.ts checks they match).
 * Semantic versioning: patch (1.0.x) for fixes and small behaviour changes,
 * minor (1.x.0) for new features or settings, major (x.0.0) for changes that
 * break old data or remove features.
 */
export interface Release {
  /** Semantic version, without the "v". */
  version: string
  /** YYYY-MM-DD */
  date: string
  highlights: string[]
}

export const RELEASES: readonly Release[] = [
  {
    version: '1.0.1',
    date: '2026-11-18',
    highlights: [
      'Pay off a credit card, loan or debt without logging past months or a statement balance. A payment bigger than what the app knows you owe is treated as an older balance: it comes out of your money and the card stops at ₱0 instead of going into credit.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-11-18',
    highlights: [
      'A budget that builds itself: each category is set from what you spent last month.',
      'No setup to get through. Start logging and everything is worked out from your transactions, including your income.',
      'Paid monthly, twice a month, weekly or daily, with paydays you can move for weekends and holidays.',
      'Cash, bank, e-wallet, credit card, loan and debt accounts, grouped with totals. Transfers can carry a fee.',
      'Quick add with a number pad, plus income categories such as Salary, Allowance and Bonus.',
      'Optional in Settings: "Safe to pay on your credit card" each month, and Carry-over of what is left from earlier months.',
      'Works offline, installs to your home screen, and saves backup files. Light and dark themes.',
    ],
  },
]

/** The running app's version (from package.json). */
export const APP_VERSION: string = __APP_VERSION__
