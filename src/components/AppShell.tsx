import { ChartPie, CreditCard, House, List, Lock, Plus, SlidersHorizontal, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useAddTransaction } from '@/hooks/useAddTransaction'
import { useShortcuts } from '@/hooks/useShortcuts'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { premiumEnabled, premiumFeature, useEntitlement, type PremiumFeatureId } from '@/premium'

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Home', icon: House },
  { to: '/transactions', label: 'Transactions', icon: List },
  { to: '/budget', label: 'Budget', icon: ChartPie },
  { to: '/accounts', label: 'Accounts', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal },
]

/**
 * Screens pushed on top of a tab: on phones they hide the bottom tab bar.
 * Entries ending in "/" match every path under them; others match exactly.
 */
const PUSHED = [
  '/add',
  '/breakdown',
  '/settings/',
  '/account',
  '/account/',
  '/privacy',
  '/terms',
  '/refunds',
  '/premium',
  '/premium/',
  '/debt-planner',
  '/reports',
  '/recurring',
]

/** Premium features listed in the sidebar (laptops and up). */
const SIDEBAR_PREMIUM: PremiumFeatureId[] = ['reports', 'debtPlanner']

const ring = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/** Plain centred column (onboarding and loading states). */
export function Column({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto flex min-h-dvh w-full flex-col bg-background', className)}>{children}</div>
}

/** Phones: bottom tab bar. */
function BottomTabs() {
  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 flex w-full border-t border-border bg-card px-2 pt-1.5 md:hidden"
    >
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-lg pt-2 pb-3 text-[11px] font-semibold',
              ring,
              isActive ? 'text-link' : 'text-muted-foreground',
            )
          }
        >
          <Icon className="size-[22px]" strokeWidth={2} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

/** Tablets (md to lg): navigation rail with an Add button on top. */
function NavRail() {
  const openAdd = useAddTransaction()
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-[88px] flex-none flex-col items-center gap-3 border-r border-border bg-card py-6 md:flex lg:hidden"
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => openAdd()}
            aria-label="Add transaction"
            aria-keyshortcuts="N"
            className={cn('mb-3 flex size-14 items-center justify-center rounded-card bg-primary text-primary-foreground hover:bg-primary/90', ring)}
          >
            <Plus className="size-5" strokeWidth={2.4} aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          Add transaction <kbd className="ml-1 font-sans">N</kbd>
        </TooltipContent>
      </Tooltip>
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            cn(
              'group flex min-h-14 w-full flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-semibold',
              ring,
              isActive ? 'text-link' : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {({ isActive }) => (
            <>
              <span
                className={cn(
                  'flex h-8 w-[52px] items-center justify-center rounded-full transition-colors',
                  isActive ? 'bg-success-tint' : 'group-hover:bg-muted',
                )}
              >
                <Icon className="size-[22px]" strokeWidth={2} aria-hidden="true" />
              </span>
              {label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

/** Laptops and desktops (lg+): sidebar with app name, Add button and full labels. */
function Sidebar() {
  const openAdd = useAddTransaction()
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-60 flex-none flex-col gap-5 border-r border-border bg-card px-4 py-7 lg:flex"
    >
      <p className="mx-3 font-heading text-xl font-bold text-link">Auto Budget</p>
      <button
        type="button"
        onClick={() => openAdd()}
        aria-keyshortcuts="N"
        className={cn(
          'flex h-12 items-center justify-center gap-2 rounded-lg bg-primary text-[15px] font-semibold text-primary-foreground hover:bg-primary/90',
          ring,
        )}
      >
        <Plus className="size-5" strokeWidth={2.4} aria-hidden="true" />
        Add transaction
      </button>
      <div className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-semibold',
                ring,
                isActive ? 'bg-success-tint text-success-text' : 'text-foreground hover:bg-muted',
              )
            }
          >
            <Icon className="size-[22px]" strokeWidth={2} aria-hidden="true" />
            {label}
          </NavLink>
        ))}
        <SidebarPremium />
      </div>
      <p className="mx-3 text-xs leading-normal text-muted-foreground">
        Press <kbd className="rounded border border-input px-1.5 py-px font-sans text-xs">N</kbd> to add a transaction
      </p>
    </nav>
  )
}

/** Reports and Debt planner, with a lock for free users. Hidden when Premium is off. */
function SidebarPremium() {
  const ent = useEntitlement()
  if (!premiumEnabled) return null
  return (
    <>
      <div className="mx-3 my-2 border-t border-border" aria-hidden="true" />
      {SIDEBAR_PREMIUM.map((id) => {
        const f = premiumFeature(id)
        const Icon = f.icon
        return (
          <NavLink
            key={id}
            to={f.path}
            className={({ isActive }) =>
              cn(
                'flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[15px] font-semibold',
                ring,
                isActive ? 'bg-success-tint text-success-text' : 'text-foreground hover:bg-muted',
              )
            }
          >
            <Icon className="size-[22px]" strokeWidth={2} aria-hidden="true" />
            <span className="flex-1">{f.shortName}</span>
            {!ent.isPremium && <Lock className="size-4 text-muted-foreground" aria-label="Premium" />}
          </NavLink>
        )
      })}
    </>
  )
}

/** Every signed-in screen: navigation for the current size plus the content column. */
export function AppLayout() {
  const { pathname } = useLocation()
  const pushed = PUSHED.some((p) => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p))
  useShortcuts()

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-dvh bg-background md:flex">
        <NavRail />
        <Sidebar />
        <main
          className={cn(
            'min-w-0 flex-1 px-5 md:px-6 md:pt-8 md:pb-12 lg:px-[clamp(16px,3vw,40px)]',
            pushed ? 'pt-4 pb-[calc(24px+env(safe-area-inset-bottom))]' : 'pt-7 pb-[calc(96px+env(safe-area-inset-bottom))]',
          )}
        >
          <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 md:gap-5 lg:max-w-[1100px] xl:max-w-[1280px]">
            <Outlet />
          </div>
        </main>
        {!pushed && <BottomTabs />}
      </div>
    </TooltipProvider>
  )
}
