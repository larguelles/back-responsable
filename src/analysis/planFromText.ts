import OpenAI from 'openai';
import { AnalysisPlanSchema, type AnalysisPlan } from '../schemas/planSchema.js';

export const planFromText = async (args: {
  client: OpenAI;
  question: string;
  timezone: string;
}): Promise<AnalysisPlan> => {
  const prompt = `
You convert a user's question about their expenses into a JSON "AnalysisPlan".
Return ONLY valid JSON. No markdown. No commentary.

Decision rules (strict):
- If the user is asking about past or current spending (e.g. "how much did I spend", "last month", "this month", "month to date", "yesterday", "last 30 days"), you MUST NOT use kind:"forecast". Use kind:"metric" (or "breakdown"/"list" if asked).
- Use kind:"forecast" ONLY if the user explicitly asks to predict/estimate future spending (keywords: predict, forecast, estimate, expected, projection, "next month", "in the next X days").
- For "how much did I spend" use kind:"metric" with op:"sum", field:"amountCents".
- For "how many" use kind:"metric" with op:"count".
- For "by day/category/item" use kind:"breakdown" and set groupBy accordingly.
- For "show transactions" use kind:"list".
- For comparisons ("vs", "compare", "this month vs last month") use kind:"compare".
- Prefer range.preset when possible. For "last month" use preset:"last_month".

Important privacy constraint:
- The question may contain tokens like CAT_1 or ITEM_2. Treat those tokens as opaque strings. Do NOT attempt to guess their real values.

Examples:
Q: "How much did I spend last month on ITEM_2?" or "Cuánto gasté el mes pasado en ITEM_2?"
A: {"kind":"metric","op":"sum","field":"amountCents","range":{"preset":"last_month","timezone":"..."},"filters":{"itemName":"ITEM_2"}}

Q: "Forecast my CAT_1 spending for next month" or "Pronosticá cuánto voy a gastar en CAT_1 este mes"
A: {"kind":"forecast","target":{"op":"sum","field":"amountCents","filters":{"categoryName":"groceries"}},"historyRange":{"preset":"last_30_days","timezone":"..."},"horizonDays":30}


Timezone: ${args.timezone}

User question:
${args.question}
`.trim();

const resp = await args.client.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: "Return only valid JSON. No markdown. No commentary." },
    { role: "user", content: prompt },
  ],
  response_format: { type: "json_object" },
  temperature: 0,
});

const text = resp.choices[0]?.message?.content ?? "";
const json = JSON.parse(text);

const parsed = AnalysisPlanSchema.safeParse(json);
if (!parsed.success) {
  console.error("LLM raw output:", text);
  throw new Error(`LLM returned invalid plan: ${parsed.error.message}`);
}
return parsed.data;
};
