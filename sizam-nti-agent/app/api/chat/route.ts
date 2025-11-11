// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";

// соответствие названию источника на фронте → домены для web-search
const SOURCE_DOMAIN_MAP: Record<string, string[]> = {
  IEEE: ["ieeexplore.ieee.org"],
  SpringerLink: ["link.springer.com"],
  ScienceDirect: ["www.sciencedirect.com", "sciencedirect.com"],
  Wiley: ["onlinelibrary.wiley.com"],
  PubMed: ["pubmed.ncbi.nlm.nih.gov", "www.ncbi.nlm.nih.gov"],
  arXiv: ["arxiv.org"],
  Scopus: ["www.scopus.com"],
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not set" },
      { status: 500 }
    );
  }

  const client = new OpenAI({ apiKey });

  try {
    const body = await req.json();

    const {
      topic = "",
      keywords = "",
      periodFrom = "",
      periodTo = "",
      sources = [],
      scenario = "by_sources",
      history = [],
      docTypes = [],
      languages = [],
      needRu = true,
      needMetrics = true,
    } = body;

    // человекочитаемый период
    const period =
      periodFrom && periodTo
        ? `${periodFrom} — ${periodTo}`
        : periodFrom
        ? `с ${periodFrom}`
        : periodTo
        ? `до ${periodTo}`
        : "не указан";

    // общая часть пользовательского запроса
    const baseUserMessage = `
Тема запроса: ${topic || "не указана"}
Ключевые слова: ${keywords || "не указаны"}
Период: ${period}
Типы документов: ${
      docTypes.length ? docTypes.join(", ") : "статьи, обзоры, патенты, конференции"
    }
Языки: ${languages.length ? languages.join(", ") : "английский, при наличии — русский"}
Нужен перевод на русский: ${needRu ? "да" : "нет"}
Нужны метрики и релевантность: ${needMetrics ? "да" : "нет"}
`.trim();

    // утилита: вытащить текст из responses API
    const extractText = (resp: any): string => {
      const out = resp.output ?? resp;
      if (!out) return "";
      if (Array.isArray(out)) {
        return out
          .map((item: any) =>
            "content" in item ? item.content?.[0]?.text?.value ?? "" : ""
          )
          .join("\n");
      }
      return "";
    };

    // =====================================================
    // СЦЕНАРИЙ 1: пользователь выбрал конкретные источники
    // =====================================================
    if (scenario === "by_sources" && Array.isArray(sources) && sources.length > 0) {
      // домены для web-search
      const domains: string[] = sources.flatMap(
        (s: string) => SOURCE_DOMAIN_MAP[s] || []
      );

      const resp = await client.responses.create({
        model: "gpt-4o",
        tools: [
          {
            type: "web_search_preview",
            ...(domains.length ? { domains } : {}),
          },
        ],
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              baseUserMessage +
              `\nОграничь поисковые источники указанными выше доменами. Выведи таблицу.`,
          },
          // история из фронта (если есть)
          ...history,
        ],
      });

      const answer = extractText(resp);
      return NextResponse.json({ answer });
    }

    // =====================================================
    // СЦЕНАРИЙ 2: подобрать источники автоматически
    // 1) сначала спрашиваем "какие домены"
    // 2) затем ищем по ним
    // =====================================================

    // 1. авто-подбор доменов
    const sourcesResp = await client.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search_preview",
        },
      ],
      input: [
        {
          role: "system",
          content:
            "Ты помогаешь выбрать лучшие источники (домены) для поиска научно-технической информации. Верни 5-7 доменов, по одному в строку, без комментариев.",
        },
        {
          role: "user",
          content: `Тема: ${topic}. Ключевые слова: ${keywords}. Период: ${period}.`,
        },
      ],
    });

    const sourcesText = extractText(sourcesResp);
    const autoDomains = sourcesText
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l && !l.startsWith("#"))
      .slice(0, 7);

    // 2. основной поиск
    const mainResp = await client.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search_preview",
          ...(autoDomains.length ? { domains: autoDomains } : {}),
        },
      ],
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            baseUserMessage +
            (autoDomains.length
              ? `\nИспользуй для поиска преимущественно эти домены: ${autoDomains.join(
                  ", "
                )}. Выведи таблицу.`
              : `\nВыведи таблицу.`),
        },
        ...history,
      ],
    });

    const answer = extractText(mainResp);
    return NextResponse.json({ answer });
  } catch (err: any) {
    console.error("chat route error", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}










