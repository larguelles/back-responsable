import { z } from 'zod';

export const PeriodPreset = z.enum([
  'today',
  'yesterday',
  'week_to_date',
  'month_to_date',
  'year_to_date',
  'last_7_days',
  'last_30_days',
  'last_month',
  'this_month',
  'this_year',
]);

const IsoDate = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'Invalid ISO date' });

export const DateRange = z
  .object({
    preset: PeriodPreset.optional(),
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    timezone: z.string().optional(),
  })
  .refine((r) => r.preset || r.from || r.to, {
    message: 'Must provide preset or from/to',
  });

export const AmountFilter = z
  .object({
    gteCents: z.number().int().nonnegative().optional(),
    lteCents: z.number().int().nonnegative().optional(),
  })
  .optional();

export const StringMatch = z
  .object({
    field: z.enum(['categoryName', 'itemName', 'any']),
    op: z.enum(['equals', 'contains']),
    value: z.string().min(1).max(120),
  })
  .optional();

export const Filters = z
  .object({
    categoryName: z.string().min(1).max(80).optional(),
    itemName: z.string().min(1).max(120).optional(),
    match: StringMatch,
    amount: AmountFilter,
  })
  .optional();

export const MetricOp = z.enum(['sum', 'avg', 'count', 'min', 'max']);
export const MetricField = z.enum(['amountCents']);

export const MetricPlan = z.object({
  kind: z.literal('metric'),
  op: MetricOp,
  field: MetricField.default('amountCents'),
  range: DateRange,
  filters: Filters,
});

export const GroupBy = z.enum(['day', 'week', 'month', 'category', 'item']);

export const BreakdownPlan = z.object({
  kind: z.literal('breakdown'),
  op: z.enum(['sum', 'count']).default('sum'),
  field: MetricField.default('amountCents'),
  groupBy: GroupBy,
  range: DateRange,
  filters: Filters,
  limit: z.number().int().min(1).max(50).optional(),
});

export const ListPlan = z.object({
  kind: z.literal('list'),
  range: DateRange,
  filters: Filters,
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

export const ComparePlan = z.object({
  kind: z.literal('compare'),
  op: MetricOp,
  field: MetricField.default('amountCents'),
  a: DateRange,
  b: DateRange,
  filters: Filters,
});

export const ForecastPlan = z.object({
  kind: z.literal('forecast'),
  target: z.object({
    op: z.enum(['sum']).default('sum'),
    field: MetricField.default('amountCents'),
    filters: Filters,
  }),
  historyRange: DateRange,
  horizonDays: z.number().int().min(7).max(60).default(30),
});

export const AnalysisPlanSchema = z.discriminatedUnion('kind', [
  MetricPlan,
  BreakdownPlan,
  ListPlan,
  ComparePlan,
  ForecastPlan,
]);

export type AnalysisPlan = z.infer<typeof AnalysisPlanSchema>;
