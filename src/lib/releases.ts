/**
 * What's new, newest first. When releasing: bump "version" in package.json and
 * add an entry here with the same version (releases.test.ts checks they match).
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
