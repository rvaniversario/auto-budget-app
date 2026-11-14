import { cloudEnabled } from '@/sync'

/**
 * Premium needs the backend (accounts and payments) and the explicit flag.
 * When off, there are no Premium entry points, badges or paywall, and the app
 * behaves like version 1 (apart from the loan account type).
 */
export const premiumEnabled = cloudEnabled && import.meta.env.VITE_PREMIUM_ENABLED === 'true'
