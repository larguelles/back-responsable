// src/dev/runPlan.ts
import 'dotenv/config';
import { executePlan } from '../analysis/executePlan.js';
import { prisma } from '../db/prisma.js';
import { AnalysisPlanSchema } from '../schemas/planSchema.js';

const run = async () => {
  const timezone = 'America/Argentina/Buenos_Aires';

  const plans = [
    {
      kind: 'metric',
      op: 'sum',
      field: 'amountCents',
      range: { preset: 'month_to_date', timezone },
      filters: undefined,
    },
    {
      kind: 'breakdown',
      op: 'sum',
      field: 'amountCents',
      groupBy: 'category',
      range: { preset: 'this_month', timezone },
      filters: undefined,
      limit: 10,
    },
    {
      kind: 'list',
      range: { preset: 'last_7_days', timezone },
      filters: undefined,
      limit: 10,
      cursor: undefined,
    },
    {
      kind: 'compare',
      op: 'sum',
      field: 'amountCents',
      a: { preset: 'month_to_date', timezone },
      b: { preset: 'last_month', timezone },
      filters: undefined,
    },
    {
      kind: 'forecast',
      target: {
        op: 'sum',
        field: 'amountCents',
        filters: undefined,
      },
      historyRange: { preset: 'last_30_days', timezone },
      horizonDays: 30,
    },
  ] as const;

  for (const [i, raw] of plans.entries()) {
    const parsed = AnalysisPlanSchema.safeParse(raw);
    if (!parsed.success) {
      console.error(`\n[${i + 1}/${plans.length}] INVALID PLAN`);
      console.error(parsed.error.flatten());
      continue;
    }

    console.log(`\n[${i + 1}/${plans.length}] PLAN`);
    console.dir(parsed.data, { depth: null });

    const result = await executePlan(prisma, parsed.data);

    console.log(`[${i + 1}/${plans.length}] RESULT`);
    console.dir(result, { depth: null });
  }
};

run()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error('\nRUN FAILED:', err);
    await prisma.$disconnect();
    process.exitCode = 1;
  });
