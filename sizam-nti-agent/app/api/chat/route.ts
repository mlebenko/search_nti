// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";

export const dynamic = "force-dynamic";

// соответствие названий из интерфейса доменам
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
    .map((d) => d.replace(/^\d+\.\s*/, "")) // убираем "1. ieee.org"
    .map((d) => d.replace(/\/+$/g, ""))
    .filter(Boolean);
}

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
      model = "gpt-4o",
    } = body;

    const period =
      periodFrom && periodTo
        ? `${periodFrom} — ${periodTo}`
        : periodFrom
        ? `с ${periodFrom}`
        : periodTo
        ? `до ${periodTo}`
        : "не указан";

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

    //
    // 1. Режим: пользователь сам выбрал источники
    //
    if (scenario === "by_sources" && Array.isArray(sources) && sources.length > 0) {
      const rawDomains = sources.flatMap((s: string) => SOURCE_DOMAIN_MAP[s] || []);
      const domains = sanitizeDomains(rawDomains);
      const filterText = domains.length
        ? `Ищи и подбирай документы прежде всего с этих сайтов/доменов: ${domains.join(
            ", "
          )}. Если документ без рабочей ссылки или DOI — не включай его.`
        : `Если документ без рабочей ссылки или DOI — не включай его.`;

      const resp = await client.responses.create({
        model: model || "gpt-4o",
        tools: [{ type: "web_search_preview" }],
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `${baseBlock}
${filterText}
Выведи одну таблицу.`,
          },
          ...history,
        ],
      });

      const answer = extractText(resp);
      return NextResponse.json({ answer, notice: "" });
    }

    //
    // 2. Режим: авто-подбор источников
    //
    // 2А. сначала попросим модель собрать домены (без параметров инструмента)
    let autoDomains: string[] = [];
    try {
      const picked = await client.responses.create({
        model: "gpt-4o",
        tools: [{ type: "web_search_preview" }],
        input: [
          {
            role: "user",
            content: `Подбери 5–7 доменов (сайтов) для поиска НТИ по теме: ${topic}. Ключевые слова: ${keywords}. Период: ${period}. Верни только домены, по одному в строку, без нумерации и комментариев.`,
          },
        ],
      });
      const pickedText = extractText(picked);
      autoDomains = sanitizeDomains(
        pickedText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 7)
      );
    } catch {
      // если не получилось — дефолт
      autoDomains = sanitizeDomains([
        "ieeexplore.ieee.org",
        "link.springer.com",
        "www.sciencedirect.com",
        "onlinelibrary.wiley.com",
      ]);
    }

    const autoFilterText = autoDomains.length
      ? `Используй для поиска прежде всего эти домены: ${autoDomains.join(
          ", "
        )}. Если по ним мало результатов — можешь добавить близкие по теме. Документы без ссылки/DOI не включай.`
      : `Документы без ссылки/DOI не включай.`;

    // 2Б. основной поиск
    const resp = await client.responses.create({
      model: model || "gpt-4o",
      tools: [{ type: "web_search_preview" }],
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `${baseBlock}
${autoFilterText}
Выведи одну таблицу.`,
        },
        ...history,
      ],
    });

    const answer = extractText(resp);
    return NextResponse.json({ answer, notice: "" });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}


