import { useEffect, useSyncExternalStore } from 'react'
import type { ThemePreference } from '@/core'
import { safeStorage } from '@/lib/browser'

/** Mirrors the saved theme so index.html can apply it before React loads (no flash). */
export const THEME_STORAGE_KEY = 'auto-budget:theme'

const THEME_COLORS = { light: '#EEF3F2', dark: '#05090B' }
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function subscribeSystem(callback: () => void) {
  const m = media()
  m.addEventListener('change', callback)
  return () => m.removeEventListener('change', callback)
}

function systemIsDark() {
  return media().matches
}

/** Apply the theme preference to <html> and keep it in sync with the OS setting. */
export function useApplyTheme(preference: ThemePreference): 'light' | 'dark' {
  const systemDark = useSyncExternalStore(subscribeSystem, systemIsDark, () => false)
  const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', resolved === 'dark')
    root.style.colorScheme = resolved
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[resolved])
    safeStorage.set(THEME_STORAGE_KEY, preference)
  }, [resolved, preference])

  return resolved
}
