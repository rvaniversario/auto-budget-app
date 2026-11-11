import { useSyncExternalStore } from 'react'

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

/** Tablet and up (Tailwind `md`, 768px): navigation rail, dialogs instead of pages. */
export const useIsMd = () => useMediaQuery('(min-width: 768px)')

/** Laptop and up (Tailwind `lg`, 1024px): sidebar and dashboard grids. */
export const useIsLg = () => useMediaQuery('(min-width: 1024px)')

/** A mouse or trackpad (usually with a keyboard): type amounts instead of using the number pad. */
export const useFinePointer = () => useMediaQuery('(pointer: fine)')
