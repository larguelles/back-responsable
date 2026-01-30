// src/analysis/executePlan.ts
import type { Prisma, PrismaClient } from '../generated/prisma/index.js';
import type { AnalysisPlan } from '../schemas/planSchema.js';
import { resolveDateRange, type ResolvedRange } from './range.js';

type MetricOp = 'sum' | 'avg' | 'count' | 'min' | 'max';
type BreakdownOp = 'sum' | 'count';
type GroupBy = 'day' | 'week' | 'month' | 'category' | 'item';

type MetricResult = { kind: 'metric'; op: MetricOp; value: number };

type BreakdownResult = {
  kind: 'breakdown';
  groupBy: GroupBy;
  op: BreakdownOp;
  rows: Array<{ key: string; value: number }>;
};

type ListResult = {
  kind: 'list';
  items: Array<{
    id: string;
    amountCents: number;
    occurredAt: Date;
    categoryName: string;
    itemName: string;
  }>;
  nextCursor?: string;
};

type CompareResult = { kind: 'compare'; op: MetricOp; a: number; b: number };

type ForecastResult = {
  kind: 'forecast';
  horizonDays: number;
  predictedTotalCents: number;
  avgDailyCents: number;
};

export type ExecuteResult =
  | MetricResult
  | BreakdownResult
  | ListResult
  | CompareResult
  | ForecastResult;

type NormalizedFilters = {
  categoryName?: string;
  itemName?: string;
  match?: {
    field: 'categoryName' | 'itemName' | 'any';
    op: 'equals' | 'contains';
    value: string;
  };
  amount?: {
    gteCents?: number;
    lteCents?: number;
  };
};

const isDefined = <T>(v: T | undefined): v is T => v !== undefined;

const normalizeFilters = (raw: unknown): NormalizedFilters | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;

  const f = raw as {
    categoryName?: string | undefined;
    itemName?: string | undefined;
    match?:
      | {
          field: 'categoryName' | 'itemName' | 'any';
          op: 'equals' | 'contains';
          value: string;
        }
      | undefined;
    amount?:
      | {
          gteCents?: number | undefined;
          lteCents?: number | undefined;
        }
      | undefined;
  };

  const out: NormalizedFilters = {};

  if (typeof f.categoryName === 'string' && f.categoryName.length > 0) {
    out.categoryName = f.categoryName;
  }
  if (typeof f.itemName === 'string' && f.itemName.length > 0) {
    out.itemName = f.itemName;
  }

  if (f.match && typeof f.match.value === 'string' && f.match.value.length > 0) {
    out.match = f.match;
  }

  if (f.amount) {
    const amt: NormalizedFilters['amount'] = {};
    if (typeof f.amount.gteCents === 'number') amt.gteCents = f.amount.gteCents;
    if (typeof f.amount.lteCents === 'number') amt.lteCents = f.amount.lteCents;
    if (Object.keys(amt).length) out.amount = amt;
  }

  return Object.keys(out).length ? out : undefined;
};

const asDayKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const asMonthKey = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const startOfIsoWeekMonday = (d: Date) => {
  const x = new Date(d);
  const day = x.getDay(); // 0 Sun .. 6 Sat
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
};

const asWeekKey = (d: Date) => asDayKey(startOfIsoWeekMonday(d));

const buildOccurredAt = (resolved: ResolvedRange): Prisma.DateTimeFilter | undefined => {
  const out: Prisma.DateTimeFilter = {};

  if (resolved.from) out.gte = resolved.from;
  if (resolved.to) out.lte = resolved.to;

  return Object.keys(out).length ? out : undefined;
};

const buildAmountFilter = (amount: NormalizedFilters['amount']): Prisma.IntFilter | undefined => {
  if (!amount) return undefined;

  const out: Prisma.IntFilter = {};
  if (isDefined(amount.gteCents)) out.gte = amount.gteCents;
  if (isDefined(amount.lteCents)) out.lte = amount.lteCents;

  return Object.keys(out).length ? out : undefined;
};

const buildNameFilter = (op: 'equals' | 'contains', value: string): Prisma.StringFilter => {
  return op === 'contains' ? { contains: value } : { equals: value };
};

const buildWhere = (resolved: ResolvedRange, filtersRaw?: unknown): Prisma.ExpenseWhereInput => {
  const filters = normalizeFilters(filtersRaw);
  const where: Prisma.ExpenseWhereInput = {};

  const occurredAt = buildOccurredAt(resolved);
  if (occurredAt) where.occurredAt = occurredAt;

  const amountCents = buildAmountFilter(filters?.amount);
  if (amountCents) where.amountCents = amountCents;

  if (filters?.categoryName) {
    where.category = { name: filters.categoryName } satisfies Prisma.CategoryWhereInput;
  }

  if (filters?.itemName) {
    where.item = { name: filters.itemName } satisfies Prisma.ItemWhereInput;
  }

  if (filters?.match) {
    const { field, op, value } = filters.match;
    const nameFilter = buildNameFilter(op, value);

    if (field === 'categoryName') {
      where.category = { name: nameFilter } satisfies Prisma.CategoryWhereInput;
    } else if (field === 'itemName') {
      where.item = { name: nameFilter } satisfies Prisma.ItemWhereInput;
    } else {
      where.OR = [
        { category: { name: nameFilter } satisfies Prisma.CategoryWhereInput },
        { item: { name: nameFilter } satisfies Prisma.ItemWhereInput },
      ];
    }
  }

  return where;
};

const computeMetric = async (
  prisma: PrismaClient,
  op: MetricOp,
  where: Prisma.ExpenseWhereInput,
): Promise<number> => {
  if (op === 'count') {
    return prisma.expense.count({ where });
  }

  const args: Prisma.ExpenseAggregateArgs = { where };

  if (op === 'sum') args._sum = { amountCents: true };
  if (op === 'avg') args._avg = { amountCents: true };
  if (op === 'min') args._min = { amountCents: true };
  if (op === 'max') args._max = { amountCents: true };

  const agg = await prisma.expense.aggregate(args);

  if (op === 'sum') return agg._sum?.amountCents ?? 0;
  if (op === 'avg') return Math.round(agg._avg?.amountCents ?? 0);
  if (op === 'min') return agg._min?.amountCents ?? 0;
  if (op === 'max') return agg._max?.amountCents ?? 0;

  return 0;
};

const fetchExpensesForJsAggregation = async (
  prisma: PrismaClient,
  where: Prisma.ExpenseWhereInput,
) => {
  return prisma.expense.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    include: { category: true, item: true },
  });
};

export const executePlan = async (
  prisma: PrismaClient,
  plan: AnalysisPlan,
): Promise<ExecuteResult> => {
  if (plan.kind === 'metric') {
    const resolved = resolveDateRange(plan.range);
    const where = buildWhere(resolved, plan.filters);
    const value = await computeMetric(prisma, plan.op, where);
    return { kind: 'metric', op: plan.op, value };
  }

  if (plan.kind === 'list') {
    const resolved = resolveDateRange(plan.range);
    const where = buildWhere(resolved, plan.filters);

    const rows = await prisma.expense.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      take: plan.limit,
      include: { category: true, item: true },
    });

    const result: ListResult = {
      kind: 'list',
      items: rows.map((r) => ({
        id: r.id,
        amountCents: r.amountCents,
        occurredAt: r.occurredAt,
        categoryName: r.category.name,
        itemName: r.item.name,
      })),
    };

    return result;
  }

  if (plan.kind === 'compare') {
    const ra = resolveDateRange(plan.a);
    const rb = resolveDateRange(plan.b);

    const whereA = buildWhere(ra, plan.filters);
    const whereB = buildWhere(rb, plan.filters);

    const [a, b] = await Promise.all([
      computeMetric(prisma, plan.op, whereA),
      computeMetric(prisma, plan.op, whereB),
    ]);

    return { kind: 'compare', op: plan.op, a, b };
  }

  if (plan.kind === 'breakdown') {
    const resolved = resolveDateRange(plan.range);
    const where = buildWhere(resolved, plan.filters);

    const expenses = await fetchExpensesForJsAggregation(prisma, where);

    const buckets = new Map<string, number>();

    for (const e of expenses) {
      let key: string;

      if (plan.groupBy === 'day') key = asDayKey(e.occurredAt);
      else if (plan.groupBy === 'week') key = asWeekKey(e.occurredAt);
      else if (plan.groupBy === 'month') key = asMonthKey(e.occurredAt);
      else if (plan.groupBy === 'category') key = e.category.name;
      else key = e.item.name;

      const inc = plan.op === 'count' ? 1 : e.amountCents;
      buckets.set(key, (buckets.get(key) ?? 0) + inc);
    }

    let rows = Array.from(buckets.entries()).map(([key, value]) => ({ key, value }));

    if (plan.groupBy === 'day' || plan.groupBy === 'week' || plan.groupBy === 'month') {
      rows.sort((a, b) => (a.key < b.key ? 1 : -1));
    } else {
      rows.sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
    }

    if (isDefined(plan.limit)) rows = rows.slice(0, plan.limit);

    return { kind: 'breakdown', groupBy: plan.groupBy, op: plan.op, rows };
  }

  // forecast
  {
    const resolvedHistory = resolveDateRange(plan.historyRange);
    const where = buildWhere(resolvedHistory, plan.target.filters);

    const expenses = await fetchExpensesForJsAggregation(prisma, where);

    const perDay = new Map<string, number>();
    for (const e of expenses) {
      const k = asDayKey(e.occurredAt);
      perDay.set(k, (perDay.get(k) ?? 0) + e.amountCents);
    }

    const daysObserved =
      resolvedHistory.from && resolvedHistory.to
        ? Math.max(
            1,
            Math.ceil(
              (resolvedHistory.to.getTime() - resolvedHistory.from.getTime()) /
                (24 * 60 * 60 * 1000) +
                1,
            ),
          )
        : Math.max(1, perDay.size);

    const total = Array.from(perDay.values()).reduce((s, v) => s + v, 0);
    const avgDailyCents = Math.round(total / daysObserved);
    const predictedTotalCents = avgDailyCents * plan.horizonDays;

    return {
      kind: 'forecast',
      horizonDays: plan.horizonDays,
      predictedTotalCents,
      avgDailyCents,
    };
  }
};
