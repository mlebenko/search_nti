// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

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

// чуть подчистим то, что пришло от модели / из интерфейса
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

// таймаут, чтобы Vercel не ждал бесконечно
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

    //
    // 1. Режим: пользователь сам выбрал источники
    //
    if (scenario === "by_sources" && Array.isArray(sources) && sources.length > 0) {
      // превращаем названия из интерфейса в домены
      const rawDomains = sources.flatMap((s: string) => SOURCE_DOMAIN_MAP[s] || []);
      const domains = sanitizeDomains(rawDomains);
      const domainText = domains.length
        ? `Ищи ТОЛЬКО по этим доменам / сайтам: ${domains.join(
            ", "
          )}. Если документ без рабочей ссылки или DOI — НЕ включай его в таблицу.`
        : "Если документ без рабочей ссылки или DOI — не включай его в таблицу.";

      const resp = await withTimeout(
        client.responses.create({
          model: model || "gpt-4o",
          tools: [
            {
              type: "web_search_preview",
            },
          ],
          input: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: baseBlock + "\n" + domainText + "\nВыведи одну таблицу.",
            },
            ...history,
          ],
        }),
        22000
      );

      const answer = extractText(resp);
      return NextResponse.json({ answer, notice: "" });
    }

    //
    // 2. Режим: авто-подбор источников
    //
    // 2А. сначала просим подобрать домены (всегда на gpt-4o, без параметров)
    let autoDomains: string[] = [];
    try {
      const picked = await withTimeout(
        client.responses.create({
          model: "gpt-4o",
          tools: [{ type: "web_search_preview" }],
          input: [
            {
              role: "user",
              content: `Подбери 5–7 доменов (сайтов) для поиска НТИ по теме: ${topic}. Ключевые слова: ${keywords}. Период: ${period}. Верни ТОЛЬКО домены, по одному в строку, без нумерации, без комментариев.`,
            },
          ],
        }),
        12000
      );
      const pickedText = extractText(picked);
      autoDomains = sanitizeDomains(
        pickedText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 7)
      );
    } catch {
      // если не удалось — даём дефолт
      autoDomains = sanitizeDomains([
        "ieeexplore.ieee.org",
        "link.springer.com",
        "www.sciencedirect.com",
        "onlinelibrary.wiley.com",
      ]);
    }

    const autoDomainText = autoDomains.length
      ? `Используй для поиска преимущественно эти домены: ${autoDomains.join(
          ", "
        )}. Если по ним мало результатов — можешь добавить соседние в этой же теме. Документы без ссылки/DOI не выводи.`
      : "Документы без ссылки/DOI не выводи.";

    // 2Б. основной поиск — уже на выбранной модели
    try {
      const resp = await withTimeout(
        client.responses.create({
          model: model || "gpt-4o",
          tools: [
            {
              type: "web_search_preview",
            },
          ],
          input: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: baseBlock + "\n" + autoDomainText + "\nВыведи одну таблицу.",
            },
            ...history,
          ],
        }),
        22000
      );

      const answer = extractText(resp);
      return NextResponse.json({ answer, notice: "" });
    } catch (e) {
      // если и тут не уложились — вернём мягкую заглушку
      const notice =
        "Автоматический поиск занял слишком много времени или вернул мало результатов. Уточните период или выберите источники вручную.";
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

