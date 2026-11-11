import { useEffect } from 'react'
import { useAddTransaction } from '@/hooks/useAddTransaction'

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"]')
}

/**
 * Keyboard shortcuts for devices with a keyboard:
 *  N  opens Add transaction
 *  /  focuses the search box on screens that have one ([data-search])
 * Esc is handled by the dialogs and sheets themselves.
 */
export function useShortcuts() {
  const openAdd = useAddTransaction()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (isTyping(e.target)) return
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return

      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault()
        openAdd()
      } else if (e.key === '/') {
        const search = document.querySelector<HTMLInputElement>('[data-search]')
        if (search) {
          e.preventDefault()
          search.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openAdd])
}
