// src/analysis/planFromText.ts
import OpenAI from "openai";
import { AnalysisPlanSchema, type AnalysisPlan } from "../schemas/planSchema.js";

export const planFromText = async (args: {
  client: OpenAI;
  question: string;
  timezone: string;
}): Promise<AnalysisPlan> => {
  const prompt = `
You convert a user's question about their expenses into a JSON "AnalysisPlan".
Return ONLY valid JSON. No markdown. No commentary.

Rules:
- Must match this shape (high level):
  - kind: one of "metric" | "breakdown" | "list" | "compare" | "forecast"
  - Use range.preset when possible; otherwise use range.from/to (ISO strings).
  - If the user asks for "how much did I spend", prefer kind:"metric" op:"sum".
  - If the user asks "by category/item/day", prefer kind:"breakdown" groupBy accordingly.
  - If the user asks for "show me transactions", prefer kind:"list".
  - If comparing periods, use kind:"compare" with a and b.
  - For forecast requests, use kind:"forecast" and pick a sensible historyRange preset.

Important privacy constraint:
- The question may contain tokens like CAT_1 or ITEM_2. Treat those tokens as opaque strings. Do NOT attempt to guess their real values.

Timezone: ${args.timezone}

User question:
${args.question}
`.trim();

  const resp = await args.client.responses.create({
    model: "gpt-4o-mini",
    input: prompt,
  });

  const text = resp.output_text ?? "";
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      json = JSON.parse(text.slice(start, end + 1));
    } else {
      throw new Error("LLM did not return JSON");
    }
  }

  const parsed = AnalysisPlanSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error("LLM returned invalid plan");
  }

  return parsed.data;
};
