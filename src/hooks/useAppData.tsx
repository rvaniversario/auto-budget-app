import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { computeMonthModel, todayISO, type AppSnapshot, type MonthModel } from '@/core'

interface AppData {
  snapshot: AppSnapshot
  model: MonthModel
}

const AppDataContext = createContext<AppData | null>(null)

/** Today's date, refreshed when the day changes (app left open overnight). */
export function useToday(): string {
  const [today, setToday] = useState(() => todayISO())
  useEffect(() => {
    const tick = () => setToday((prev) => (prev === todayISO() ? prev : todayISO()))
    const id = window.setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])
  return today
}

export function AppDataProvider({ snapshot, children }: { snapshot: AppSnapshot; children: ReactNode }) {
  const today = useToday()
  const model = useMemo(() => computeMonthModel(snapshot, today), [snapshot, today])
  const value = useMemo(() => ({ snapshot, model }), [snapshot, model])
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

/** Live app data and this month's computed model. Updates whenever stored data changes. */
export function useAppData(): AppData {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData must be used inside AppDataProvider')
  return ctx
}
