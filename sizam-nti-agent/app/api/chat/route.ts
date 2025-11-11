// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";

const SOURCE_DOMAIN_MAP: Record<string, string[]> = {
  IEEE: ["ieeexplore.ieee.org"],
  SpringerLink: ["link.springer.com"],
  ScienceDirect: ["www.sciencedirect.com", "sciencedirect.com"],
  Wiley: ["onlinelibrary.wiley.com"],
  PubMed: ["pubmed.ncbi.nlm.nih.gov", "www.ncbi.nlm.nih.gov"],
  arXiv: ["arxiv.org"],
  Scopus: ["www.scopus.com"],
};

// убираем протоколы и хвостовые слэши
function sanitizeDomains(domains: string[]): string[] {
  return domains
    .map((d) => d.trim())
    .map((d) => d.replace(/^https?:\/\//i, ""))
    .map((d) => d.replace(/\/+$/g, ""))
    .filter(Boolean);
}

// пытаемся вынуть текст из разных форматов ответа Responses API
function extractText(resp: any): string {
  if (!resp) return "";

  // иногда бывает resp.output_text
  if (resp.output_text) {
    return resp.output_text;
  }

  const out = resp.output ?? resp;
  if (Array.isArray(out)) {
    return out
      .map((item: any) =>
        "content" in item ? item.content?.[0]?.text?.value ?? "" : ""
      )
      .join("\n");
  }

  return "";
}

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

    const period =
      periodFrom && periodTo
        ? `${periodFrom} — ${periodTo}`
        : periodFrom
        ? `с ${periodFrom}`
        : periodTo
        ? `до ${periodTo}`
        : "не указан";

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

    // ===== СЦЕНАРИЙ 1: источники заданы =====
    if (scenario === "by_sources" && Array.isArray(sources) && sources.length > 0) {
      const rawDomains: string[] = sources.flatMap(
        (s: string) => SOURCE_DOMAIN_MAP[s] || []
      );
      const domains = sanitizeDomains(rawDomains);

      // 1. пробуем через Responses + web_search
      const resp = await client.responses.create({
        model: "gpt-4o",
        tools: [
          {
            // каст в any, чтобы TS не спорил
            type: "web_search",
            ...(domains.length ? { domains } : {}),
          } as any,
        ],
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              baseUserMessage +
              `\nОграничь поисковые источники указанными выше доменами. Выведи таблицу.`,
          },
          ...history,
        ],
      });

      let answer = extractText(resp);

      // 2. если всё равно пусто — фолбэк на обычный чат
      if (!answer) {
        const chatFallback = await client.chat.completions.create({
          model: "gpt-4o",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content:
                baseUserMessage +
                `\nИсточники: ${domains.join(", ") || "не заданы"}.\nВыведи таблицу.`,
            },
            ...history,
          ],
        });

        answer = chatFallback.choices[0]?.message?.content ?? "";
      }

      return NextResponse.json({ answer });
    }

    // ===== СЦЕНАРИЙ 2: подобрать автоматически =====

    // 2.1 просим модель подобрать домены (тоже через responses)
    const sourcesResp = await client.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search",
        } as any,
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
    const autoDomains = sanitizeDomains(
      sourcesText
        .split("\n")
        .map((l: string) => l.trim())
        .filter((l: string) => l && !l.startsWith("#"))
        .slice(0, 7)
    );

    // 2.2 основной поиск по подобранным доменам
    const mainResp = await client.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search",
          ...(autoDomains.length ? { domains: autoDomains } : {}),
        } as any,
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

    let answer = extractText(mainResp);

    // фолбэк, если responses ничего не вернул
    if (!answer) {
      const chatFallback = await client.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              baseUserMessage +
              (autoDomains.length
                ? `\nИсточники: ${autoDomains.join(
                    ", "
                  )}.\nВыведи таблицу.`
                : `\nВыведи таблицу.`),
          },
          ...history,
        ],
      });

      answer = chatFallback.choices[0]?.message?.content ?? "";
    }

    return NextResponse.json({ answer });
  } catch (err: any) {
    console.error("chat route error", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}












