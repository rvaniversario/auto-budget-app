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
    version: '1.2.0',
    date: '2026-11-21',
    highlights: [
      'A new look: a dark grid background with soft glows, glass cards and neon highlights, in both light and dark themes, with smaller, tidier text.',
      'Tap any account to see only its transactions, with money in and out this month. Edit the account from the pencil button, or add a transaction to it with the + button.',
      'When Safe to pay is off, Home no longer mentions it.',
      'The version button has moved to the bottom of each screen.',
    ],
  },
  {
    version: '1.1.1',
    date: '2026-11-21',
    highlights: [
      'No more mixed messages on a fresh start: Home no longer says your bills are more than what is left when you have no bills. It says "No bills set up yet" instead.',
      'Your plan waits for your income: before you log any, Budget asks you to add it instead of saying you are "Over by ₱3,000". Your buffer is set aside once income comes in.',
    ],
  },
  {
    version: '1.1.0',
    date: '2026-11-19',
    highlights: [
      'New on Home: "Left after bills", what remains once the bills still to pay this month are set aside, after everything you have spent and paid, and about how much that gives you a day until payday.',
      'Card, loan and debt balances work as before 1.0.1 again: a payment bigger than what you owe shows as a credit on the card.',
    ],
  },
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
