import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { AddTransactionPanel, type AddPrefill } from '@/components/AddTransactionPanel'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useIsMd } from '@/hooks/useMedia'

type OpenAdd = (prefill?: AddPrefill) => void

const AddTransactionContext = createContext<OpenAdd | null>(null)

function toSearch(prefill?: AddPrefill): string {
  const params = new URLSearchParams()
  if (prefill?.type) params.set('type', prefill.type)
  if (prefill?.to) params.set('to', prefill.to)
  if (prefill?.categoryId) params.set('category', prefill.categoryId)
  if (prefill?.from) params.set('from', prefill.from)
  const s = params.toString()
  return s ? `?${s}` : ''
}

/**
 * Opens Add transaction: a full-screen page on phones, a centred dialog from
 * tablet width up.
 */
export function AddTransactionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const isMd = useIsMd()
  const [open, setOpen] = useState(false)
  const [prefill, setPrefill] = useState<AddPrefill | undefined>()
  // Remount the form on every open so defaults are fresh.
  const [session, setSession] = useState(0)

  const openAdd = useCallback<OpenAdd>(
    (p) => {
      if (!isMd) {
        navigate(`/add${toSearch(p)}`)
        return
      }
      setPrefill(p)
      setSession((n) => n + 1)
      setOpen(true)
    },
    [isMd, navigate],
  )

  const value = useMemo(() => openAdd, [openAdd])

  return (
    <AddTransactionContext.Provider value={value}>
      {children}
      <Dialog open={open && isMd} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-bold">Add transaction</DialogTitle>
            <DialogDescription className="sr-only">Log an expense, income or transfer</DialogDescription>
          </DialogHeader>
          <AddTransactionPanel key={session} prefill={prefill} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </AddTransactionContext.Provider>
  )
}

export function useAddTransaction(): OpenAdd {
  const ctx = useContext(AddTransactionContext)
  if (!ctx) throw new Error('useAddTransaction must be used inside AddTransactionProvider')
  return ctx
}
