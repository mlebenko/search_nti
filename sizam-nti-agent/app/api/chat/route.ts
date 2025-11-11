// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 25; // чтобы Vercel не держал нас 300с

// соответствие названий из фронта и доменов
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
    .map((d) => d.replace(/^\d+\.\s*/, "")) // "1. ieee.org" -> "ieeexplore..."
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

// простая обёртка, чтобы обрубить долгие запросы
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    promise
      .then((res) => {
        clearTimeout(id);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(id);
        reject(err);
      });
  });
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

    // 1) пользователь сам выбрал источники
    if (scenario === "by_sources" && Array.isArray(sources) && sources.length > 0) {
      const rawDomains = sources.flatMap((s: string) => SOURCE_DOMAIN_MAP[s] || []);
      const domains = sanitizeDomains(rawDomains);

      const resp = await withTimeout(
        client.responses.create({
          model: model || "gpt-4o",
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
                baseBlock +
                "\nОграничь поисковые источники указанными доменами. Выведи одну таблицу.",
            },
            ...history,
          ],
        }),
        22000
      );

      const answer = extractText(resp);
      return NextResponse.json({ answer, notice: "" });
    }

    // 2) автоподбор источников
    // сначала подбираем сами домены — ВСЕГДА на gpt-4o, чтобы не зависало
    let autoDomains: string[] = [];
    try {
      const pick = await withTimeout(
        client.responses.create({
          model: "gpt-4o",
          tools: [{ type: "web_search_preview" }],
          input: [
            {
              role: "user",
              content: `Подбери 5-7 доменов для поиска НТИ по теме: ${topic}. Ключевые слова: ${keywords}. Период: ${period}. Верни ТОЛЬКО домены, по одному в строку, без нумерации и комментариев.`,
            },
          ],
        }),
        12000
      );
      const pickedText = extractText(pick);
      autoDomains = sanitizeDomains(
        pickedText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 7)
      );
    } catch {
      // если не смогли подобрать — дефолт
      autoDomains = sanitizeDomains([
        "ieeexplore.ieee.org",
        "link.springer.com",
        "www.sciencedirect.com",
        "onlinelibrary.wiley.com",
      ]);
    }

    // основной поиск — уже на выбранной модели
    let notice = "";
    try {
      const resp = await withTimeout(
        client.responses.create({
          model: model || "gpt-4o",
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
                baseBlock +
                (autoDomains.length
                  ? `\nИспользуй преимущественно эти домены: ${autoDomains.join(
                      ", "
                    )}. Выведи одну таблицу.`
                  : "\nВыведи одну таблицу."),
            },
            ...history,
          ],
        }),
        22000
      );

      const answer = extractText(resp);
      return NextResponse.json({ answer, notice });
    } catch (e) {
      notice =
        "Автоматический поиск занял слишком много времени, параметры были упрощены. Попробуйте указать источники вручную или сократить период.";
      return NextResponse.json(
        {
          answer:
            "| № | Название | Источник | Примечание |\n|---|---|---|---|\n| 1 | Результат не получен | — | " +
            notice +
            " |",
          notice,
        },
        { status: 200 }
      );
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
