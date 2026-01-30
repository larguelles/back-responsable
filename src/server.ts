// src/server.ts
import cors from "cors";
import "dotenv/config";
import express from "express";
import OpenAI from "openai";
import { z } from "zod";
import { prisma } from "./db/prisma.js";

import { executePlan } from "./analysis/executePlan.js";
import { buildMasking } from "./analysis/masking.js";
import { planFromText } from "./analysis/planFromText.js";
import { resolveDateRange } from "./analysis/range.js";
import { AnalysisPlanSchema } from "./schemas/planSchema.js";

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url}`);
  next();
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

const ChatBody = z.object({
  message: z.string().min(1).max(4000),
});

app.post("/chat", async (req, res) => {
  if (!client) return res.status(501).json({ error: "AI not configured" });

  const parsed = ChatBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  try {
    const response = await client.responses.create({
      model: "gpt-4o-mini",
      input: parsed.data.message,
    });

    return res.json({ text: response.output_text ?? "" });
  } catch {
    return res.status(500).json({ error: "OpenAI request failed" });
  }
});

const CreateExpenseBody = z.object({
  amountCents: z.number().int().positive(),
  categoryName: z.string().trim().min(1).max(80),
  itemName: z.string().trim().min(1).max(120),
  occurredAt: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), { message: "Invalid ISO date" })
    .optional(),
});

app.post("/expenses", async (req, res) => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const { amountCents, categoryName, itemName, occurredAt } = parsed.data;

  try {
    const category = await prisma.category.upsert({
      where: { name: categoryName },
      update: {},
      create: { name: categoryName },
    });

    const item = await prisma.item.upsert({
      where: { name: itemName },
      update: {},
      create: { name: itemName },
    });

    const expense = await prisma.expense.create({
      data: {
        amountCents,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        categoryId: category.id,
        itemId: item.id,
      },
      include: { category: true, item: true },
    });

    return res.status(201).json({ expense });
  } catch (err) {
    console.error("POST /expenses failed:", err);
    return res.status(500).json({ error: "Failed to create expense" });
  }
});

app.get("/categories", async (_req, res) => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { name: "asc" } });
    return res.json({ categories });
  } catch (err) {
    console.error("GET /categories failed: ", err);
    return res.status(500).json({ error: "Failed to load categories" });
  }
});

app.get("/items", async (_req, res) => {
  try {
    const items = await prisma.item.findMany({ orderBy: { name: "asc" } });
    return res.json({ items });
  } catch (err) {
    console.error("GET /items failed: ", err);
    return res.status(500).json({ error: "Failed to load items" });
  }
});

app.get("/expenses", async (req, res) => {
  const fromStr = typeof req.query.from === "string" ? req.query.from : undefined;
  const toStr = typeof req.query.to === "string" ? req.query.to : undefined;

  const from = fromStr ? new Date(fromStr) : undefined;
  const to = toStr ? new Date(toStr) : undefined;

  if (fromStr && Number.isNaN(from!.getTime())) return res.status(400).json({ error: "Invalid from" });
  if (toStr && Number.isNaN(to!.getTime())) return res.status(400).json({ error: "Invalid to" });

  try {
    const expenses = await prisma.expense.findMany({
      where: {
        ...(from ? { occurredAt: { gte: from } } : {}),
        ...(to ? { occurredAt: { lte: to } } : {}),
      },
      orderBy: { occurredAt: "desc" },
      include: { category: true, item: true },
    });

    return res.json({ expenses });
  } catch (err) {
    console.error("GET /expenses failed:", err);
    return res.status(500).json({ error: "Failed to load expenses" });
  }
});

const RunAnalysisBody = z.object({
  plan: AnalysisPlanSchema,
});

app.post("/analysis/run", async (req, res) => {
  const parsed = RunAnalysisBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  try {
    const plan = parsed.data.plan;
    const tz = (() => {
      if (plan.kind === "compare") return plan.a.timezone ?? plan.b.timezone ?? "America/Argentina/Buenos_Aires";
      if (plan.kind === "forecast") return plan.historyRange.timezone ?? "America/Argentina/Buenos_Aires";
      return plan.range.timezone ?? "America/Argentina/Buenos_Aires";
    })();

    if (plan.kind === "compare") {
      resolveDateRange(plan.a);
      resolveDateRange(plan.b);
    } else if (plan.kind === "forecast") {
      resolveDateRange(plan.historyRange);
    } else {
      resolveDateRange(plan.range);
    }

    const result = await executePlan(prisma, plan);
    return res.json({ result });
  } catch (err) {
    console.error("POST /analysis/run failed:", err);
    return res.status(500).json({ error: "Failed to run analysis" });
  }
});

const PlanFromTextBody = z.object({
  question: z.string().trim().min(1).max(2000),
  timezone: z.string().optional(),
});

app.post("/analysis/plan", async (req, res) => {
  if (!client) return res.status(501).json({ error: "AI not configured" });

  const parsed = PlanFromTextBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const timezone = parsed.data.timezone ?? "America/Argentina/Buenos_Aires";

  try {
    const [cats, items] = await Promise.all([
      prisma.category.findMany({ select: { name: true } }),
      prisma.item.findMany({ select: { name: true } }),
    ]);

    const masking = buildMasking({
      categories: cats.map((c) => c.name),
      items: items.map((i) => i.name),
    });

    const maskedQuestion = masking.maskText(parsed.data.question);

    const planMasked = await planFromText({
      client,
      question: maskedQuestion,
      timezone,
    });

    const plan = masking.unmaskPlan(planMasked);

    const planParsed = AnalysisPlanSchema.safeParse(plan);
    if (!planParsed.success) return res.status(400).json({ error: "Plan invalid after unmask" });

    return res.json({ plan: planParsed.data });
  } catch (err) {
    console.error("POST /analysis/plan failed:", err);
    return res.status(500).json({ error: "Failed to build plan" });
  }
});

app.listen(3000, () => {
  console.log("API listening on http://localhost:3000");
});
