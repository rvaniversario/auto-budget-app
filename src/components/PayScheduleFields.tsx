import { Controller, useWatch, type UseFormReturn } from 'react-hook-form'
import { z } from 'zod'
import {
  budgetPeriodFor,
  formatPeriod,
  paydaysInPeriod,
  payWeekday,
  secondPayday,
  todayISO,
  weekdayName,
  weekdayShort,
  workWeekdays,
  PAY_FREQUENCY_LABEL,
  type PayFrequency,
  type Settings,
} from '@/core'
import { ChoiceChips, TextInput } from '@/components/inputs'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { dayField } from '@/lib/forms'
import { cn } from '@/lib/utils'

const FREQUENCIES: PayFrequency[] = ['monthly', 'semimonthly', 'weekly', 'daily']
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] // Monday first

export const payFormSchema = z
  .object({
    frequency: z.enum(['monthly', 'semimonthly', 'weekly', 'daily']),
    payday: dayField,
    secondPayday: z.string(),
    payWeekday: z.string(),
    workWeekdays: z.array(z.number()),
  })
  .superRefine((v, ctx) => {
    if (v.frequency === 'semimonthly') {
      const r = dayField.safeParse(v.secondPayday)
      if (!r.success) ctx.addIssue({ code: 'custom', path: ['secondPayday'], message: 'Pick a day' })
      else if (Number(v.secondPayday) === Number(v.payday)) {
        ctx.addIssue({ code: 'custom', path: ['secondPayday'], message: 'Pick a different day from your first payday' })
      }
    }
    if (v.frequency === 'daily' && v.workWeekdays.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['workWeekdays'], message: 'Pick at least one day' })
    }
  })

export type PayForm = z.infer<typeof payFormSchema>

export function payFormDefaults(settings: Settings | undefined): PayForm {
  const base = settings ?? { paydayDay: 30 }
  return {
    frequency: settings?.payFrequency ?? 'monthly',
    payday: String(base.paydayDay),
    secondPayday: String(secondPayday(base)),
    payWeekday: String(payWeekday(settings ?? {})),
    workWeekdays: [...workWeekdays(settings ?? {})],
  }
}

export function payFormToSettings(v: PayForm): Partial<Settings> {
  return {
    payFrequency: v.frequency,
    paydayDay: Number(v.payday),
    // Only store what the chosen frequency uses; the rest keep their defaults.
    ...(v.frequency === 'semimonthly' && { secondPaydayDay: Number(v.secondPayday) }),
    ...(v.frequency === 'weekly' && { payWeekday: Number(v.payWeekday) }),
    ...(v.frequency === 'daily' && { workWeekdays: [...v.workWeekdays].sort((a, b) => a - b) }),
  }
}

const PAYDAY_LABEL: Record<PayFrequency, string> = {
  monthly: 'Payday (day of the month)',
  semimonthly: 'First payday (starts your budget month)',
  weekly: 'Budget month starts on (day of the month)',
  daily: 'Budget month starts on (day of the month)',
}

/** Frequency and payday fields (how much you get comes from logged income), with a preview of this budget month. */
export function PayScheduleFields({
  form,
  idPrefix,
  labelClass,
  existing,
}: {
  form: UseFormReturn<PayForm>
  idPrefix: string
  labelClass: string
  /** Saved settings, so the preview honours paydays already moved. */
  existing?: Settings
}) {
  const v = useWatch({ control: form.control }) as PayForm
  const frequency = v.frequency ?? 'monthly'
  const preview = previewFor(v, existing)

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-2">
        <span id={`${idPrefix}-freq-label`} className={labelClass}>
          How often are you paid?
        </span>
        <Controller
          name="frequency"
          control={form.control}
          render={({ field }) => (
            <ChoiceChips
              label="How often are you paid?"
              columns={2}
              value={field.value}
              onChange={field.onChange}
              options={FREQUENCIES.map((f) => ({ value: f, label: PAY_FREQUENCY_LABEL[f] }))}
              className="[&>button]:h-[52px] [&>button]:text-[15px]"
            />
          )}
        />
      </div>

      {frequency === 'weekly' && (
        <Controller
          name="payWeekday"
          control={form.control}
          render={({ field }) => (
            <div className="flex flex-col gap-2">
              <span className={labelClass}>Payday</span>
              <ChoiceChips
                label="Weekday you are paid"
                columns={7}
                value={field.value}
                onChange={field.onChange}
                options={WEEKDAYS.map((d) => ({ value: String(d), label: weekdayShort(d).slice(0, 2), ariaLabel: weekdayName(d) }))}
                className="gap-1 [&>button]:px-0"
              />
            </div>
          )}
        />
      )}

      {frequency === 'daily' && (
        <Controller
          name="workWeekdays"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="gap-2">
              <span id={`${idPrefix}-days-label`} className={labelClass}>
                Days you work and get paid
              </span>
              <div role="group" aria-labelledby={`${idPrefix}-days-label`} className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((d) => {
                  const on = field.value.includes(d)
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      aria-label={weekdayName(d)}
                      onClick={() => field.onChange(on ? field.value.filter((x) => x !== d) : [...field.value, d])}
                      className={cn(
                        'h-11 rounded-lg border text-sm font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-card text-foreground hover:bg-muted',
                      )}
                    >
                      {weekdayShort(d).slice(0, 2)}
                    </button>
                  )
                })}
              </div>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      )}

      <div className={cn('grid gap-3', frequency === 'semimonthly' && 'grid-cols-2')}>
        <Controller
          name="payday"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="gap-1.5">
              <FieldLabel htmlFor={`${idPrefix}-payday`} className={labelClass}>
                {PAYDAY_LABEL[frequency]}
              </FieldLabel>
              <TextInput id={`${idPrefix}-payday`} inputMode="numeric" maxLength={2} aria-invalid={fieldState.invalid} {...field} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        {frequency === 'semimonthly' && (
          <Controller
            name="secondPayday"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1.5">
                <FieldLabel htmlFor={`${idPrefix}-payday2`} className={labelClass}>
                  Second payday
                </FieldLabel>
                <TextInput id={`${idPrefix}-payday2`} inputMode="numeric" maxLength={2} aria-invalid={fieldState.invalid} {...field} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        )}
      </div>
      <p className="-mt-2 text-[13px] text-muted-foreground">
        {frequency === 'monthly' || frequency === 'semimonthly'
          ? 'Your budget month runs from payday to the day before the next. In shorter months we use the last day. You can move a payday for a weekend or holiday later in Settings.'
          : 'Pick the day your budget month starts, for example the 1st. In shorter months we use the last day.'}
      </p>

      {preview && (
        <div className="flex flex-col gap-1 rounded-lg bg-success-tint p-3.5" aria-live="polite">
          <span className="text-[13px]">This budget month</span>
          <span className="money text-lg font-bold text-success-text">{formatPeriod(preview.period)}</span>
          {frequency !== 'monthly' && (
            <span className="text-[13px]">
              {preview.paydays} {frequency === 'daily' ? 'paid days' : 'paydays'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function previewFor(v: PayForm, existing: Settings | undefined) {
  const day = Number(v.payday)
  if (!Number.isInteger(day) || day < 1 || day > 31) return null
  const second = Number(v.secondPayday)
  const settings = {
    payFrequency: v.frequency ?? 'monthly',
    paydayDay: day,
    secondPaydayDay: Number.isInteger(second) && second >= 1 && second <= 31 ? second : undefined,
    payWeekday: Number(v.payWeekday),
    workWeekdays: v.workWeekdays,
    // Moved dates only apply while the regular payday stays the same.
    paydayOverrides: existing && existing.paydayDay === day ? existing.paydayOverrides : undefined,
  }
  const period = budgetPeriodFor(settings, todayISO())
  const paydays = paydaysInPeriod(settings, period).length
  return { period, paydays }
}
