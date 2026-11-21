import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { TransactionType } from '@/core'
import { AddTransactionPanel, type AddPrefill } from '@/components/AddTransactionPanel'
import { SubHeader } from '@/components/layout'
import { useAddTransaction } from '@/hooks/useAddTransaction'
import { useIsMd } from '@/hooks/useMedia'

/** Full-screen Add transaction for phones. On tablet and up it opens the dialog instead. */
export function AddTransactionScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const isMd = useIsMd()
  const openAdd = useAddTransaction()

  const [prefill] = useState<AddPrefill>(() => {
    const t = params.get('type')
    const type: TransactionType | undefined = t === 'income' || t === 'transfer' || t === 'expense' ? t : undefined
    return { type, to: params.get('to'), categoryId: params.get('category'), from: params.get('from') }
  })

  // A deep link to /add on a wide screen: go Home and show the dialog.
  useEffect(() => {
    if (isMd) {
      navigate('/', { replace: true })
      openAdd(prefill)
    }
  }, [isMd, navigate, openAdd, prefill])

  if (isMd) return null

  const close = () => (window.history.length > 1 ? navigate(-1) : navigate('/'))
  return (
    <>
      <SubHeader title="Add transaction" close />
      <AddTransactionPanel prefill={prefill} onDone={close} />
    </>
  )
}
