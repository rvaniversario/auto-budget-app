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
import { AccountsScreen } from '@/screens/AccountsScreen'
import { AddTransactionScreen } from '@/screens/AddTransactionScreen'
import { BreakdownScreen } from '@/screens/BreakdownScreen'
import { BudgetScreen } from '@/screens/BudgetScreen'
import { HomeScreen } from '@/screens/HomeScreen'
import { Onboarding } from '@/screens/onboarding/Onboarding'
import { BillsScreen, CategoriesScreen, SettingsScreen } from '@/screens/SettingsScreen'
import { TransactionsScreen } from '@/screens/TransactionsScreen'

/** Applies the saved theme and hosts the toast area (which needs the resolved theme). */
function Chrome({ theme }: { theme: ThemePreference }) {
  const resolved = useApplyTheme(theme)
  return <Toaster position="top-center" theme={resolved} />
}

export default function App() {
  // undefined = loading, null = no settings yet (new user)
  const snapshot = useLiveQuery(() => repo.getSnapshot(), [])

  if (snapshot === undefined) {
    return <div className="min-h-dvh bg-background" aria-busy="true" />
  }

  if (!snapshot || !snapshot.settings.onboardingComplete) {
    return (
      <>
        <Chrome theme={snapshot?.settings.theme ?? 'system'} />
        <Onboarding />
      </>
    )
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
            <Route path="*" element={<HomeScreen />} />
          </Route>
        </Routes>
      </AddTransactionProvider>
      <InstallHint />
    </AppDataProvider>
  )
}
