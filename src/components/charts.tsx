import { useId, useState, type ReactNode } from 'react'
import { formatMoney, type Centavos } from '@/core'
import { cn } from '@/lib/utils'

/**
 * Small dependency-free SVG charts. Colours come from the theme tokens
 * (--chart-*), every series also has a text label, and each chart takes a
 * `summary` sentence plus a table toggle as its text alternative.
 */

export const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)']
export const OTHER_COLOR = 'var(--chart-other)'

const W = 640
const H = 240
const PAD = { top: 12, right: 12, bottom: 28, left: 56 }

const short = (v: Centavos) => {
  const pesos = v / 100
  if (Math.abs(pesos) >= 1_000_000) return `₱${(pesos / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (Math.abs(pesos) >= 1_000) return `₱${(pesos / 1_000).toFixed(1).replace(/\.0$/, '')}k`
  return `₱${Math.round(pesos)}`
}

/** A top value whose quarters are round numbers (4 equal grid steps). */
function niceMax(v: number): number {
  if (v <= 0) return 100_00
  const raw = v / 4
  const exp = Math.pow(10, Math.floor(Math.log10(raw)))
  const f = raw / exp
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp
  return step * 4
}

function Axis({ max, labels, every = 1 }: { max: number; labels: string[]; every?: number }) {
  const ticks = [0, 0.25, 0.5, 0.75, 1]
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const step = labels.length > 0 ? plotW / labels.length : plotW
  return (
    <g aria-hidden="true">
      {ticks.map((t) => {
        const y = PAD.top + plotH * (1 - t)
        return (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />
            <text x={PAD.left - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)">
              {short(max * t)}
            </text>
          </g>
        )
      })}
      {labels.map((l, i) =>
        i % every === 0 ? (
          <text key={i} x={PAD.left + step * i + step / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
            {l}
          </text>
        ) : null,
      )}
    </g>
  )
}

export interface ChartSeries {
  name: string
  values: Centavos[]
  color?: string
  /** Dashed line, for a budget or comparison line. */
  dashed?: boolean
}

function Legend({ series }: { series: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px]">
      {series.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={cn('inline-block h-2.5 w-4 flex-none rounded-sm', s.dashed && 'h-0 border-t-2 border-dashed bg-transparent')}
            style={s.dashed ? { borderColor: s.color } : { background: s.color }}
          />
          {s.name}
        </li>
      ))}
    </ul>
  )
}

/** A table of the chart's figures, shown on request (and always to screen readers). */
function DataTable({ labels, series, open }: { labels: string[]; series: { name: string; values: Centavos[] }[]; open: boolean }) {
  return (
    <div className={cn('overflow-x-auto', !open && 'sr-only')}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th scope="col" className="border-b border-border py-1.5 pr-3 text-left font-semibold text-muted-foreground">
              Month
            </th>
            {series.map((s) => (
              <th key={s.name} scope="col" className="border-b border-border px-2 py-1.5 text-right font-semibold text-muted-foreground">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="money">
          {labels.map((l, i) => (
            <tr key={i}>
              <th scope="row" className="border-b border-border py-1.5 pr-3 text-left font-sans font-medium">
                {l}
              </th>
              {series.map((s) => (
                <td key={s.name} className="border-b border-border px-2 py-1.5 text-right">
                  {formatMoney(s.values[i] ?? 0, { decimals: 'never' })}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChartFrame({
  title,
  summary,
  legend,
  labels,
  series,
  children,
}: {
  title: string
  summary: string
  legend?: ReactNode
  labels: string[]
  series: { name: string; values: Centavos[] }[]
  children: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  const id = useId()
  return (
    <figure className="flex flex-col gap-3" aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="sr-only">
        {title}. {summary}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}. ${summary}`}>
        {children}
      </svg>
      {legend}
      <button
        type="button"
        aria-expanded={showTable}
        onClick={() => setShowTable((v) => !v)}
        className="print-hidden self-start text-[13px] font-semibold text-link underline-offset-2 hover:underline"
      >
        {showTable ? 'Hide figures' : 'Show figures as a table'}
      </button>
      <DataTable labels={labels} series={series} open={showTable} />
    </figure>
  )
}

/** One or more lines over months. */
export function LineChart({ title, summary, labels, series }: { title: string; summary: string; labels: string[]; series: ChartSeries[] }) {
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const step = labels.length > 0 ? plotW / labels.length : plotW
  const x = (i: number) => PAD.left + step * i + step / 2
  const y = (v: number) => PAD.top + plotH * (1 - v / max)
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }))
  const every = Math.max(1, Math.ceil(labels.length / 8))
  return (
    <ChartFrame title={title} summary={summary} labels={labels} series={series} legend={series.length > 1 ? <Legend series={colored} /> : undefined}>
      <Axis max={max} labels={labels} every={every} />
      {colored.map((s) => (
        <g key={s.name}>
          <polyline
            points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={s.dashed ? 2 : 3}
            strokeDasharray={s.dashed ? '6 6' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {!s.dashed &&
            labels.length <= 24 &&
            s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={s.color}>
                <title>{`${labels[i]}: ${s.name} ${formatMoney(v, { decimals: 'never' })}`}</title>
              </circle>
            ))}
        </g>
      ))}
    </ChartFrame>
  )
}

/** Bars per month: stacked (categories) or side by side (income vs spending). */
export function BarChart({
  title,
  summary,
  labels,
  series,
  stacked = false,
}: {
  title: string
  summary: string
  labels: string[]
  series: ChartSeries[]
  stacked?: boolean
}) {
  const totals = labels.map((_, i) => (stacked ? series.reduce((a, s) => a + (s.values[i] ?? 0), 0) : Math.max(0, ...series.map((s) => s.values[i] ?? 0))))
  const max = niceMax(Math.max(0, ...totals))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const step = labels.length > 0 ? plotW / labels.length : plotW
  const barW = Math.min(48, step * 0.62)
  const colored = series.map((s, i) => ({ ...s, color: s.color ?? SERIES_COLORS[i % SERIES_COLORS.length] }))
  const every = Math.max(1, Math.ceil(labels.length / 12))

  return (
    <ChartFrame title={title} summary={summary} labels={labels} series={series} legend={<Legend series={colored} />}>
      <Axis max={max} labels={labels} every={every} />
      {labels.map((label, i) => {
        const cx = PAD.left + step * i + step / 2
        if (stacked) {
          let acc = 0
          return (
            <g key={i}>
              {colored.map((s) => {
                const v = s.values[i] ?? 0
                if (v <= 0) return null
                const h = (v / max) * plotH
                const yTop = PAD.top + plotH - ((acc + v) / max) * plotH
                acc += v
                return (
                  <rect key={s.name} x={cx - barW / 2} y={yTop} width={barW} height={Math.max(0, h - 1)} fill={s.color}>
                    <title>{`${label}: ${s.name} ${formatMoney(v, { decimals: 'never' })}`}</title>
                  </rect>
                )
              })}
            </g>
          )
        }
        const each = barW / colored.length
        return (
          <g key={i}>
            {colored.map((s, k) => {
              const v = s.values[i] ?? 0
              const h = (Math.max(0, v) / max) * plotH
              return (
                <rect key={s.name} x={cx - barW / 2 + each * k} y={PAD.top + plotH - h} width={Math.max(1, each - 2)} height={h} rx="2" fill={s.color}>
                  <title>{`${label}: ${s.name} ${formatMoney(v, { decimals: 'never' })}`}</title>
                </rect>
              )
            })}
          </g>
        )
      })}
    </ChartFrame>
  )
}
