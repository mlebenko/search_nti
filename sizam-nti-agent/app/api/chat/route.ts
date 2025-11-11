import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";

export const dynamic = "force-dynamic";

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

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const project = process.env.OPENAI_PROJECT_ID;
    const organization = process.env.OPENAI_ORG_ID;

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY is not set" },
        { status: 500 }
      );
    }

    // создаём клиента с тем же контекстом проекта
    const client = new OpenAI(
      organization
        ? { apiKey, project, organization }
        : project
        ? { apiKey, project }
        : { apiKey }
    );

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
        model: "gpt-4o",
        tools: [
          {
            type: "web_search",
            ...(domains.length
              ? { filters: { allowed_domains: domains } }
              : {}),
          } as any,
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

      console.log("RAW RESPONSES (by_sources):", JSON.stringify(resp, null, 2));

      const answer =
        resp.output_text ??
        (Array.isArray(resp.output)
          ? resp.output
              .map((item: any) => item?.content?.[0]?.text?.value ?? "")
              .join("\n")
          : "");

      return NextResponse.json({ answer });
    }

    // ===== 2. если источники надо подобрать автоматически =====
    const pickResp = await client.responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search" } as any],
      input: [
        {
          role: "user",
          content: `Подбери 5-7 доменов для поиска НТИ по теме: ${topic}. Ключевые слова: ${keywords}. Период: ${period}. По одному домену в строку.`,
        },
      ],
    });

    const pickedText =
      pickResp.output_text ??
      (Array.isArray(pickResp.output)
        ? pickResp.output
            .map((item: any) => item?.content?.[0]?.text?.value ?? "")
            .join("\n")
        : "");

    const autoDomains = sanitizeDomains(
      pickedText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 7)
    );

    const searchResp = await client.responses.create({
      model: "gpt-4o",
      tools: [
        {
          type: "web_search",
          ...(autoDomains.length
            ? { filters: { allowed_domains: autoDomains } }
            : {}),
        } as any,
      ],
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            baseBlock +
            (autoDomains.length
              ? `\nИспользуй для поиска эти источники: ${autoDomains.join(
                  ", "
                )}. Выведи одну таблицу.`
              : `\nВыведи одну таблицу.`),
        },
        ...history,
      ],
    });

    console.log("RAW RESPONSES (auto):", JSON.stringify(searchResp, null, 2));

    const answer2 =
      searchResp.output_text ??
      (Array.isArray(searchResp.output)
        ? searchResp.output
            .map((item: any) => item?.content?.[0]?.text?.value ?? "")
            .join("\n")
        : "");

    return NextResponse.json({ answer: answer2 });
  } catch (err: any) {
    console.error("chat route error", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}

















