// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";

export const dynamic = "force-dynamic";

// маппинг названий из фронта → домены
const SOURCE_DOMAIN_MAP: Record<string, string[]> = {
  IEEE: ["ieeexplore.ieee.org"],
  SpringerLink: ["link.springer.com"],
  ScienceDirect: ["www.sciencedirect.com", "sciencedirect.com"],
  Wiley: ["onlinelibrary.wiley.com"],
  PubMed: ["pubmed.ncbi.nlm.nih.gov", "www.ncbi.nlm.nih.gov"],
  arXiv: ["arxiv.org"],
  Scopus: ["www.scopus.com"],
};

function sanitizeDomains(domains: string[]): string[] {
  return domains
    .map((d) => d.trim())
    .map((d) => d.replace(/^https?:\/\//i, ""))
    .map((d) => d.replace(/\/+$/g, ""))
    .filter(Boolean);
}

// на всякий случай — вытащить текст из responses
function extractText(resp: any): string {
  if (!resp) return "";
  if (resp.output_text) return resp.output_text;
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
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not set" },
        { status: 500 }
      );
    }

    const client = new OpenAI({ apiKey });

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

    // базовое содержимое, как у тебя на фронте
    const baseBlock = `
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

    // ===== 1. если источники выбраны вручную =====
    if (scenario === "by_sources" && Array.isArray(sources) && sources.length > 0) {
      const rawDomains = sources.flatMap((s: string) => SOURCE_DOMAIN_MAP[s] || []);
      const domains = sanitizeDomains(rawDomains);

      const resp = await client.responses.create({
  model: "gpt-4o", // или gpt-5, если у тебя он реально есть
  tools: [
    {
      type: "web_search",
      ...(domains.length
        ? { filters: { allowed_domains: domains } }
        : {}),
    },
  ],
  input: [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        baseBlock +
        `\nОграничь поиск указанными источниками. Выведи одну таблицу.`,
    },
    ...history,
  ],
});

console.log("RAW RESPONSES:", JSON.stringify(resp, null, 2));

const answer = resp.output_text || "";
return NextResponse.json({ answer });

      const answer = extractText(resp);
      return NextResponse.json({ answer });
    }

    // ===== 2. если надо подобрать автоматически =====
    // шаг 1 — спросим модель, какие домены взять
    const pickSources = await client.responses.create({
      model: "gpt-5",
      tools: [{ type: "web_search_preview" }],
      input: [
        {
          role: "user",
          content: `Подбери 5-7 доменов для поиска НТИ по теме: ${topic}. Ключевые слова: ${keywords}. Период: ${period}. Верни по одному домену в строку, без комментариев.`,
        },
      ],
    });

    const pickedText = extractText(pickSources);
    const autoDomains = sanitizeDomains(
      pickedText
        .split("\n")
        .map((l: string) => l.trim())
        .filter(Boolean)
        .slice(0, 7)
    );

    // шаг 2 — основной поиск по этим доменам
    const main = await client.responses.create({
      model: "gpt-5",
      tools: [
        {
          type: "web_search_preview",
          ...(autoDomains.length ? { domains: autoDomains } : {}),
        },
      ],
      input: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content:
            baseBlock +
            (autoDomains.length
              ? `\nИспользуй для поиска преимущественно эти домены: ${autoDomains.join(
                  ", "
                )}. Выведи одну таблицу.`
              : `\nВыведи одну таблицу.`),
        },
        ...history,
      ],
    });

    const answer = extractText(main);
    return NextResponse.json({ answer });
  } catch (err: any) {
    console.error("chat route error", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}















