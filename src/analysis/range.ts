import type { z } from 'zod';
import { DateRange } from '../schemas/planSchema.js';

export type ResolvedRange = {
  from?: Date;
  to?: Date;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);

const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0);
const endOfYear = (d: Date) => new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);

const startOfWeekMonday = (d: Date) => {
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const m = new Date(d);
  m.setDate(d.getDate() + diff);
  return startOfDay(m);
};

const addDays = (d: Date, days: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
};

export const resolveDateRange = (range: z.infer<typeof DateRange>): ResolvedRange => {
  if (range.preset) {
    const now = new Date();

    switch (range.preset) {
      case 'today': {
        return { from: startOfDay(now), to: endOfDay(now) };
      }
      case 'yesterday': {
        const y = addDays(now, -1);
        return { from: startOfDay(y), to: endOfDay(y) };
      }
      case 'week_to_date': {
        return { from: startOfWeekMonday(now), to: endOfDay(now) };
      }
      case 'month_to_date': {
        return { from: startOfMonth(now), to: endOfDay(now) };
      }
      case 'year_to_date': {
        return { from: startOfYear(now), to: endOfDay(now) };
      }
      case 'last_7_days': {
        return { from: startOfDay(addDays(now, -6)), to: endOfDay(now) };
      }
      case 'last_30_days': {
        return { from: startOfDay(addDays(now, -29)), to: endOfDay(now) };
      }
      case 'this_month': {
        return { from: startOfMonth(now), to: endOfMonth(now) };
      }
      case 'last_month': {
        const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        return { from: startOfMonth(last), to: endOfMonth(last) };
      }
      case 'this_year': {
        return { from: startOfYear(now), to: endOfYear(now) };
      }
      default: {
        return {};
      }
    }
  }

  const fromRaw = range.from ? new Date(range.from) : undefined;
  const toRaw = range.to ? new Date(range.to) : undefined;

  const from = fromRaw && !Number.isNaN(fromRaw.getTime()) ? fromRaw : undefined;
  const to = toRaw && !Number.isNaN(toRaw.getTime()) ? toRaw : undefined;

  const out: ResolvedRange = {};
  if (from) out.from = from;
  if (to) out.to = to;
  return out;
};
