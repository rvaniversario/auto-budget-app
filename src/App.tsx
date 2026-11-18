import { useEffect, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Route, Routes } from 'react-router'
import type { ThemePreference } from '@/core'
import { repo } from '@/data'
import { AppLayout } from '@/components/AppShell'
import { InstallHint } from '@/components/InstallHint'
import { Toaster } from '@/components/ui/sonner'
import { useApplyTheme } from '@/lib/theme'
import { AddTransactionProvider } from '@/hooks/useAddTransaction'
import { AppDataProvider } from '@/hooks/useAppData'
import { AccountScreen } from '@/screens/account/AccountScreen'
import { LinkChoiceDialog } from '@/screens/account/LinkChoiceDialog'
import { SignInScreen } from '@/screens/account/SignInScreen'
import { VerifyCodeScreen } from '@/screens/account/VerifyCodeScreen'
import { AccountsScreen } from '@/screens/AccountsScreen'
import { AddTransactionScreen } from '@/screens/AddTransactionScreen'
import { BreakdownScreen } from '@/screens/BreakdownScreen'
import { BudgetScreen } from '@/screens/BudgetScreen'
import { HomeScreen } from '@/screens/HomeScreen'
import { LegalScreen } from '@/screens/LegalScreen'
import { DebtPlannerScreen } from '@/screens/DebtPlannerScreen'
import { PremiumScreen } from '@/screens/premium/PremiumScreens'
import { RecurringScreen } from '@/screens/RecurringScreen'
import { ReportsScreen } from '@/screens/ReportsScreen'
import { BackupScreen } from '@/screens/BackupScreen'
import { BillsScreen, CategoriesScreen, SettingsScreen } from '@/screens/SettingsScreen'
import { TransactionsScreen } from '@/screens/TransactionsScreen'
import { premiumEnabled } from '@/premium'
import { cloudEnabled } from '@/sync'

/** Applies the saved theme and hosts the toast area (which needs the resolved theme). */
function Chrome({ theme }: { theme: ThemePreference }) {
  const resolved = useApplyTheme(theme)
  return <Toaster position="top-center" theme={resolved} />
}

/** Account and policy screens. */
const SHARED_SCREENS: { path: string; element: ReactNode }[] = [
  ...(cloudEnabled
    ? [
        { path: 'account', element: <AccountScreen /> },
        { path: 'account/sign-in', element: <SignInScreen /> },
        { path: 'account/verify', element: <VerifyCodeScreen /> },
      ]
    : []),
  { path: 'privacy', element: <LegalScreen doc="privacy" /> },
  ...(premiumEnabled
    ? [
        { path: 'terms', element: <LegalScreen doc="terms" /> },
        { path: 'refunds', element: <LegalScreen doc="refunds" /> },
      ]
    : []),
]

/** Premium screens; the routes only exist when Premium is switched on. */
const PREMIUM_SCREENS: { path: string; element: ReactNode }[] = premiumEnabled
  ? [
      { path: 'premium', element: <PremiumScreen /> },
      { path: 'debt-planner', element: <DebtPlannerScreen /> },
      { path: 'reports', element: <ReportsScreen /> },
      { path: 'recurring', element: <RecurringScreen /> },
    ]
  : []

export default function App() {
  // undefined = loading, null = no settings yet (new user)
  const snapshot = useLiveQuery(() => repo.getSnapshot(), [])
  const needsStart = snapshot === null || (snapshot !== undefined && !snapshot.settings.onboardingComplete)

  // No setup screens: a new budget starts straight away with default settings,
  // and everything else is learned from the transactions the user logs.
  useEffect(() => {
    if (needsStart) void repo.startBudget()
  }, [needsStart])

  if (!snapshot || needsStart) {
    return <div className="min-h-dvh bg-background" aria-busy="true" />
  }

  return (
    <AppDataProvider snapshot={snapshot}>
      <Chrome theme={snapshot.settings.theme} />
      <AddTransactionProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<HomeScreen />} />
            <Route path="transactions" element={<TransactionsScreen />} />
            <Route path="budget" element={<BudgetScreen />} />
            <Route path="accounts" element={<AccountsScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="add" element={<AddTransactionScreen />} />
            <Route path="breakdown" element={<BreakdownScreen />} />
            <Route path="settings/categories" element={<CategoriesScreen />} />
            <Route path="settings/bills" element={<BillsScreen />} />
            <Route path="backup" element={<BackupScreen />} />
            {[...SHARED_SCREENS, ...PREMIUM_SCREENS].map(({ path, element }) => (
              <Route key={path} path={path} element={element} />
            ))}
            <Route path="*" element={<HomeScreen />} />
          </Route>
        </Routes>
      </AddTransactionProvider>
      <InstallHint />
      <LinkChoiceDialog />
    </AppDataProvider>
  )
}
