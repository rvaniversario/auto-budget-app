import { useMemo, useState } from 'react'
import { FileDown, FileSpreadsheet, Lightbulb, TrendingDown, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import {
  alive,
  categoryChanges,
  centavosToInput,
  escapeCell,
  formatMoney,
  formatPeriod,
  reportInsights,
  reportMonths,
  reportToCSV,
  todayISO,
  yearSummary,
  type ReportMonth,
} from '@/core'
import { useAppData } from '@/hooks/useAppData'
import { downloadFile } from '@/lib/browser'
import { cn } from '@/lib/utils'
import { BarChart, LineChart, OTHER_COLOR, SERIES_COLORS, type ChartSeries } from '@/components/charts'
import { ChoiceChips, Segmented } from '@/components/inputs'
import { SubHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PremiumGate } from '@/premium/components'

type Range = '3' | '6' | '12' | 'year'

const card = 'print-plain flex min-w-0 flex-col gap-3 rounded-card bg-card px-4 py-[18px] md:px-5'
const h2 = 'font-sans text-base font-bold'
const money0 = (v: number) => formatMoney(v, { decimals: 'never' })
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Categories drawn separately in the stacked chart; the rest are "Other". */
const TOP_CATEGORIES = 5

export function ReportsScreen() {
  return (
    <PremiumGate feature="reports">
      <Reports />
    </PremiumGate>
  )
}

/** Print the page in light colours, whatever the theme. */
function printReport() {
  const root = document.documentElement
  const wasDark = root.classList.contains('dark')
  if (wasDark) root.classList.remove('dark')
  const restore = () => {
    if (wasDark) root.classList.add('dark')
    window.removeEventListener('afterprint', restore)
  }
  window.addEventListener('afterprint', restore)
  window.print()
}

function Reports() {
  const { model } = useAppData()
  const [range, setRange] = useState<Range>('6')
  const today = model.today

  return (
    <>
      <SubHeader
        title="Reports"
        action={
          <div className="print-hidden flex gap-1">
            <Button variant="ghost" size="icon" aria-label="Save as PDF" title="Save as PDF" onClick={printReport}>
              <FileDown aria-hidden="true" />
            </Button>
          </div>
        }
      />
      <div className="print-hidden">
        <Segmented
          label="Period"
          value={range}
          onChange={setRange}
          options={[
            { value: '3', label: '3 months' },
            { value: '6', label: '6 months' },
            { value: '12', label: '12 months' },
            { value: 'year', label: 'Year' },
          ]}
        />
      </div>
      {range === 'year' ? <YearReport /> : <MonthsReport count={Number(range)} today={today} />}
    </>
  )
}

// ---------------------------------------------------------------------------

function MonthsReport({ count, today }: { count: number; today: string }) {
  const { snapshot } = useAppData()
  const months = useMemo(() => reportMonths(snapshot, today, count), [snapshot, today, count])
  const names = useMemo(() => new Map(alive(snapshot.categories).map((c) => [c.id, c.name])), [snapshot.categories])
  const insights = useMemo(() => reportInsights(months, names), [months, names])
  const labels = months.map((m) => (m.complete ? m.label.slice(0, 3) : `${m.label.slice(0, 3)}*`))
  const hasData = months.some((m) => m.spending > 0 || m.income > 0)

  const exportCSV = () => {
    downloadFile(`auto-budget-report-${todayISO()}.csv`, reportToCSV(months, names), 'text/csv;charset=utf-8')
    toast.success('Report figures exported')
  }

  if (!hasData) {
    return (
      <section className="flex flex-col items-center gap-2 rounded-card border border-dashed border-dash-line px-5 py-8 text-center">
        <h2 className="font-sans text-[17px] font-bold">Not enough to report yet</h2>
        <p className="max-w-prose text-sm text-muted-foreground">Log your spending and income for a month or two, and your trends will show up here.</p>
      </section>
    )
  }

  return (
    <>
      <p className="text-[13px] text-muted-foreground">
        {formatPeriod({ start: months[0].period.start, end: months.at(-1)!.period.end })} · budget months run payday to payday
        {!months.at(-1)!.complete && ' · * month in progress'}
      </p>

      {insights.length > 0 && (
        <section aria-labelledby="insights-title" className={cn(card, 'bg-success-tint')}>
          <h2 id="insights-title" className={cn(h2, 'flex items-center gap-2 text-success-text')}>
            <Lightbulb className="size-5" aria-hidden="true" /> What stands out
          </h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[15px] leading-snug">
            {insights.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 md:gap-5 lg:grid-cols-2 lg:items-start">
        <CategoryStack months={months} labels={labels} names={names} />
        <IncomeVsSpending months={months} labels={labels} />
        <CategoryOverTime months={months} labels={labels} names={names} />
        <Changes months={months} names={names} />
        <DebtOverTime months={months} labels={labels} />
        <PlannedVsActual months={months} />
      </div>

      <div className="print-hidden flex flex-wrap gap-2">
        <Button variant="outline" className="h-12 bg-card" onClick={printReport}>
          <FileDown aria-hidden="true" /> Save as PDF
        </Button>
        <Button variant="outline" className="h-12 bg-card" onClick={exportCSV}>
          <FileSpreadsheet aria-hidden="true" /> Export figures (CSV)
        </Button>
      </div>
    </>
  )
}

function CategoryStack({ months, labels, names }: { months: ReportMonth[]; labels: string[]; names: Map<string, string> }) {
  const totals = new Map<string, number>()
  for (const m of months) for (const [id, v] of Object.entries(m.byCategory)) totals.set(id, (totals.get(id) ?? 0) + v)
  const ranked = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
  const top = ranked.slice(0, TOP_CATEGORIES).map(([id]) => id)
  const rest = ranked.slice(TOP_CATEGORIES).map(([id]) => id)
  const series: ChartSeries[] = top.map((id, i) => ({ name: names.get(id) ?? 'Category', values: months.map((m) => m.byCategory[id] ?? 0), color: SERIES_COLORS[i] }))
  if (rest.length) series.push({ name: 'Other', values: months.map((m) => rest.reduce((a, id) => a + (m.byCategory[id] ?? 0), 0)), color: OTHER_COLOR })
  const biggest = top[0] ? names.get(top[0]) : null
  return (
    <section aria-labelledby="stack-title" className={card}>
      <h2 id="stack-title" className={h2}>
        Spending by category
      </h2>
      {series.length === 0 ? (
        <p className="text-sm text-muted-foreground">No category spending in this period.</p>
      ) : (
        <BarChart
          stacked
          title="Spending by category per month"
          summary={biggest ? `${biggest} was your biggest category over these ${months.length} months.` : ''}
          labels={labels}
          series={series}
        />
      )}
    </section>
  )
}

function IncomeVsSpending({ months, labels }: { months: ReportMonth[]; labels: string[] }) {
  const under = months.filter((m) => m.complete && m.income > 0 && m.spending < m.income).length
  const complete = months.filter((m) => m.complete && m.income > 0).length
  return (
    <section aria-labelledby="ivs-title" className={card}>
      <h2 id="ivs-title" className={h2}>
        Income and spending
      </h2>
      <BarChart
        title="Income against spending per month"
        summary={complete ? `You spent less than you earned in ${under} of ${complete} complete months.` : 'Income and spending for each month.'}
        labels={labels}
        series={[
          { name: 'Income', values: months.map((m) => m.income), color: 'var(--chart-1)' },
          { name: 'Spending', values: months.map((m) => m.spending), color: 'var(--chart-3)' },
        ]}
      />
    </section>
  )
}

function CategoryOverTime({ months, labels, names }: { months: ReportMonth[]; labels: string[]; names: Map<string, string> }) {
  const options = [...names.entries()].filter(([id]) => months.some((m) => (m.byCategory[id] ?? 0) > 0 || m.rows.some((r) => r.categoryId === id)))
  const [picked, setPicked] = useState<string | null>(null)
  const id = picked && names.has(picked) ? picked : (options[0]?.[0] ?? null)
  if (!id) return null
  const name = names.get(id)!
  const spent = months.map((m) => m.byCategory[id] ?? 0)
  const budget = months.map((m) => m.rows.find((r) => r.categoryId === id)?.budget ?? 0)
  const over = months.filter((_, i) => spent[i] > budget[i] && budget[i] > 0).length
  return (
    <section aria-labelledby="cat-title" className={card}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="cat-title" className={h2}>
          One category over time
        </h2>
        <div className="print-hidden w-full sm:w-52">
          <Select value={id} onValueChange={setPicked}>
            <SelectTrigger aria-label="Category" className="h-11 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map(([cid, n]) => (
                <SelectItem key={cid} value={cid}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <LineChart
        title={`${name}: spent and budget per month`}
        summary={`${name} went over its budget in ${over} of ${months.length} months.`}
        labels={labels}
        series={[
          { name: `${name} spent`, values: spent },
          { name: 'Budget', values: budget, color: 'var(--muted-foreground)', dashed: true },
        ]}
      />
    </section>
  )
}

function Changes({ months: all, names }: { months: ReportMonth[]; names: Map<string, string> }) {
  // Compare whole months: a month in progress would make every category look lower.
  const done = all.filter((m) => m.complete)
  const months = done.length >= 2 ? done : all
  const { increases, decreases } = categoryChanges(months, names)
  const [prev, cur] = months.slice(-2)
  if (!prev || !cur) return null
  const list = (items: typeof increases, up: boolean) =>
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground">None</p>
    ) : (
      <ul className="flex flex-col">
        {items.slice(0, 4).map((c, i) => (
          <li key={c.categoryId} className={cn('flex min-h-11 items-center justify-between gap-3', i > 0 && 'border-t border-border')}>
            <span className="truncate text-[15px] font-semibold">{c.name}</span>
            <span className={cn('money flex-none text-[15px] font-semibold', up ? 'text-warning-text' : 'text-success-text')}>
              {up ? '+' : '−'}
              {money0(Math.abs(c.change))}
            </span>
          </li>
        ))}
      </ul>
    )
  return (
    <section aria-labelledby="changes-title" className={card}>
      <div className="flex flex-col gap-0.5">
        <h2 id="changes-title" className={h2}>
          Biggest changes
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {cur.label}
          {cur.complete ? '' : ' so far'} compared with {prev.label}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-1.5 font-sans text-sm font-bold">
            <TrendingUp className="size-4" aria-hidden="true" /> Went up
          </h3>
          {list(increases, true)}
        </div>
        <div className="flex flex-col gap-1">
          <h3 className="flex items-center gap-1.5 font-sans text-sm font-bold">
            <TrendingDown className="size-4" aria-hidden="true" /> Went down
          </h3>
          {list(decreases, false)}
        </div>
      </div>
    </section>
  )
}

function DebtOverTime({ months, labels }: { months: ReportMonth[]; labels: string[] }) {
  if (months.every((m) => m.debtBalance === 0)) return null
  const first = months[0].debtBalance
  const last = months.at(-1)!.debtBalance
  return (
    <section aria-labelledby="debt-title" className={card}>
      <h2 id="debt-title" className={h2}>
        Card and loan balance
      </h2>
      <LineChart
        title="Total owed on cards and loans at the end of each month"
        summary={`From ${money0(first)} to ${money0(last)}.`}
        labels={labels}
        series={[{ name: 'Owed', values: months.map((m) => m.debtBalance), color: 'var(--chart-2)' }]}
      />
    </section>
  )
}

function PlannedVsActual({ months }: { months: ReportMonth[] }) {
  const [index, setIndex] = useState(String(months.length - 1))
  const m = months[Number(index)] ?? months.at(-1)!
  const rows = m.rows.filter((r) => r.budget > 0 || r.spent > 0)
  const th = 'border-b border-border px-2 py-2 text-xs font-semibold text-muted-foreground'
  const td = 'border-b border-border px-2 py-2'
  return (
    <section aria-labelledby="pva-title" className={cn(card, 'lg:col-span-2')}>
      <h2 id="pva-title" className={h2}>
        Planned and actual
      </h2>
      <div className="print-hidden">
        <ChoiceChips
          label="Month"
          shape="pill"
          scroll
          value={index}
          onChange={setIndex}
          options={months.map((x, i) => ({ value: String(i), label: x.complete ? x.label : `${x.label} (so far)` }))}
        />
      </div>
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Planned and actual spending for {m.label}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(th, 'text-left')}>
                Category
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Planned
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Actual
              </th>
              <th scope="col" className={cn(th, 'text-right')}>
                Difference
              </th>
            </tr>
          </thead>
          <tbody className="money">
            {rows.map((r) => {
              const diff = r.budget - r.spent
              return (
                <tr key={r.categoryId}>
                  <th scope="row" className={cn(td, 'text-left font-sans font-medium')}>
                    {r.name}
                  </th>
                  <td className={cn(td, 'text-right')}>{money0(r.budget)}</td>
                  <td className={cn(td, 'text-right')}>{money0(r.spent)}</td>
                  <td className={cn(td, 'text-right font-semibold', diff < 0 ? 'text-danger-text' : 'text-success-text')}>
                    {diff < 0 ? `${money0(-diff)} over` : `${money0(diff)} left`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

function YearReport() {
  const { snapshot, model } = useAppData()
  const thisYear = Number(model.today.slice(0, 4))
  const years = useMemo(() => {
    const set = new Set<number>([thisYear])
    for (const t of alive(snapshot.transactions)) set.add(Number(t.date.slice(0, 4)))
    return [...set].sort((a, b) => b - a)
  }, [snapshot.transactions, thisYear])
  const [year, setYear] = useState(thisYear)
  const summary = useMemo(() => yearSummary(snapshot, year), [snapshot, year])
  const saved = summary.income - summary.spending

  const exportCSV = () => {
    const rows = [
      ['month', 'income', 'spending'],
      ...summary.months.map((m) => [`${year}-${String(m.month).padStart(2, '0')}`, centavosToInput(m.income), centavosToInput(m.spending)]),
      ['total', centavosToInput(summary.income), centavosToInput(summary.spending)],
      [],
      ['category', 'spent'],
      ...summary.categories.map((c) => [c.name, centavosToInput(c.spent)]),
    ]
    downloadFile(`auto-budget-${year}-summary.csv`, rows.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n', 'text/csv;charset=utf-8')
    toast.success('Year summary exported')
  }

  return (
    <>
      {years.length > 1 && (
        <div className="print-hidden">
          <ChoiceChips label="Year" shape="pill" scroll value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
        </div>
      )}
      <section aria-label={`${year} totals`} className="print-plain grid grid-cols-3 gap-2 rounded-card bg-card p-4">
        <Total label="Income" value={summary.income} />
        <Total label="Spending" value={summary.spending} />
        <Total label={saved >= 0 ? 'Saved' : 'Overspent'} value={Math.abs(saved)} tone={saved >= 0 ? 'good' : 'bad'} />
      </section>
      <div className="grid gap-4 md:gap-5 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="year-chart" className={card}>
          <h2 id="year-chart" className={h2}>
            {year} month by month
          </h2>
          <BarChart
            title={`Income and spending in ${year}`}
            summary={`In ${year} you earned ${money0(summary.income)} and spent ${money0(summary.spending)}.`}
            labels={MONTHS}
            series={[
              { name: 'Income', values: summary.months.map((m) => m.income), color: 'var(--chart-1)' },
              { name: 'Spending', values: summary.months.map((m) => m.spending), color: 'var(--chart-3)' },
            ]}
          />
        </section>
        <section aria-labelledby="year-cats" className={card}>
          <h2 id="year-cats" className={h2}>
            Where it went
          </h2>
          {summary.categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No category spending in {year}.</p>
          ) : (
            <ul className="flex flex-col">
              {summary.categories.map((c, i) => (
                <li key={c.categoryId} className={cn('flex min-h-11 items-center justify-between gap-3', i > 0 && 'border-t border-border')}>
                  <span className="truncate text-[15px] font-semibold">{c.name}</span>
                  <span className="flex flex-none items-baseline gap-2">
                    <span className="text-[13px] text-muted-foreground">{summary.spending ? Math.round((c.spent / summary.spending) * 100) : 0}%</span>
                    <span className="money text-[15px] font-semibold">{money0(c.spent)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="print-hidden flex flex-wrap gap-2">
        <Button variant="outline" className="h-12 bg-card" onClick={printReport}>
          <FileDown aria-hidden="true" /> Save as PDF
        </Button>
        <Button variant="outline" className="h-12 bg-card" onClick={exportCSV}>
          <FileSpreadsheet aria-hidden="true" /> Export figures (CSV)
        </Button>
      </div>
    </>
  )
}

function Total({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('money truncate text-lg font-semibold', tone === 'good' && 'text-link', tone === 'bad' && 'text-danger-bar')}>{money0(value)}</span>
    </div>
  )
}
