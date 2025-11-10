import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt"; // важен относительный путь

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    console.log("[/api/chat] incoming request");

    if (!process.env.OPENAI_API_KEY) {
      console.error("[/api/chat] OPENAI_API_KEY is not set");
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not set" },
        { status: 500 }
      );
    }

    const body = await req.json();
    console.log("[/api/chat] body:", body);

const {
  topic,
  keywords,
  periodFrom,
  periodTo,
  sources = [],
  scenario = "by_sources",
  history = [],
  docTypes = [],
  languages = [],
  needRu = true,
  needMetrics = true,
} = body;

    const period =
      periodFrom && periodTo ? `${periodFrom} — ${periodTo}` : "не указан";

const userMessage = `
Тема: ${topic || "не указана"}
Ключевые слова: ${keywords || "не указаны"}
Период: ${period}
Источники: ${sources.length ? sources.join(", ") : "подбери сам"}
Типы документов: ${docTypes.length ? docTypes.join(", ") : "статьи, конференции, патенты"}
Языки: ${languages.length ? languages.join(", ") : "английский"}
Нужен перевод на русский: ${needRu ? "да" : "нет"}
Нужны метрики и релевантность: ${needMetrics ? "да" : "нет"}
Сразу выдай таблицу в формате, указанном в системном сообщении.
`.trim();

    console.log("[/api/chat] userMessage:", userMessage);

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: userMessage },
    ];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.3,
    });

    const answer = completion.choices[0]?.message?.content ?? "";
    console.log("[/api/chat] got answer length:", answer.length);

    return NextResponse.json({ answer });
  } catch (e: any) {
    console.error("[/api/chat] error:", e);
    return NextResponse.json(
      { error: e?.message || "something went wrong" },
      { status: 500 }
    );
  }
}


