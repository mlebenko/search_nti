// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";

export const dynamic = "force-dynamic";

// допустимые модели, которые мы поддерживаем в UI
const ALLOWED_MODELS = ["gpt-4o", "gpt-5"];

const SOURCE_DOMAIN_MAP: Record<string, string[]> = {
  IEEE: ["ieeexplore.ieee.org"],
  SpringerLink: ["link.springer.com"],
  ScienceDirect: ["www.sciencedirect.com", "sciencedirect.com"],
  Wiley: ["onlinelibrary.wiley.com"],
  PubMed: ["pubmed.ncbi.nlm.nih.gov", "www.ncbi.nlm.nih.gov"],
  arXiv: ["arxiv.org"],
  Scopus: ["www.scopus.com"],
};

// чистим домены
function sanitizeDomains(domains: string[]): string[] {
  return domains
    .map((d) => d.trim())
    .map((d) => d.replace(/^[\d\.\-\)\s]+/, ""))
    .map((d) => d.replace(/^https?:\/\//i, ""))
    .map((d) => d.split(/\s+/)[0])
    .map((d) => d.replace(/\/+$/g, ""))
    .filter((d) => d && d.includes("."));
}

// достаём реальные результаты поиска
function extractWebResults(resp: any): Array<{ url?: string; title?: string }> {
  if (!resp || !Array.isArray(resp.output)) return [];
  const results: Array<{ url?: string; title?: string }> = [];

  for (const item of resp.output) {
    if (item.type === "tool_output" && item.tool_name === "web_search") {
      const data = item.output ?? item.data ?? item;
      const list = Array.isArray(data?.results) ? data.results : [];
      for (const r of list) {
        results.push({
          url: r.url,
          title: r.title,
        });
      }
    }
  }

  return results;
}

// парсим markdown-таблицу
function parseMarkdownTable(md: string): { headers: string[]; rows: string[][] } {
  const lines = md.split("\n").filter(Boolean);
  const headerLine = lines.find((l) => l.trim().startsWith("|"));
  if (!headerLine) return { headers: [], rows: [] };

  const headerIdx = lines.indexOf(headerLine);
  const headers = headerLine
    .split("|")
    .map((h) => h.trim())
    .filter((h) => h.length);

  const rows: string[][] = [];
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const normalized = cells.filter((_, idx) => !(idx === 0 || idx === cells.length - 1));
    rows.push(normalized);
  }

  return { headers, rows };
}

// обратно в markdown
function buildMarkdownTable(headers: string[], rows: string[][]): string {
  const headerLine = `| ${headers.join(" | ")} |`;
  const sepLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((r) => `| ${r.join(" | ")} |`);
  return [headerLine, sepLine, ...rowLines].join("\n");
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
      model: userModel,
    } = body;

    // уведомления, которые отправим на фронт
    const notices: string[] = [];

    // если пользователь выбрал модель, которой нет — откатываем и говорим об этом
    let modelToUse =
      userModel && typeof userModel === "string" ? userModel : "gpt-4o";
    if (!ALLOWED_MODELS.includes(modelToUse)) {
      notices.push(
        `Модель "${modelToUse}" недоступна в этом окружении. Использована gpt-4o.`
      );
      modelToUse = "gpt-4o";
    }

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

    // ─────────────────────────────────────────────
    // ВЕТКА 1: пользователь выбрал конкретные источники
    // ─────────────────────────────────────────────
    if (scenario === "by_sources" && Array.isArray(sources) && sources.length > 0) {
      const rawDomains = sources.flatMap((s: string) => SOURCE_DOMAIN_MAP[s] || []);
      const domains = sanitizeDomains(rawDomains);

      const resp = await client.responses.create({
        model: modelToUse,
        tools: [
          {
            type: "web_search",
            ...(domains.length ? { filters: { allowed_domains: domains } } : {}),
          } as any,
        ],
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content:
              baseBlock +
              `
Ограничь поиск указанными источниками.
Если за указанный период и тему документов мало — добери из соседних дат этого же источника (сначала 2025, затем 2024), но НЕ запрашивай подтверждений.
Всегда возвращай одну таблицу.
В таблице ОБЯЗАТЕЛЬНО заполни "Ссылка (URL)" если она есть, иначе ставь "—".
              `.trim(),
          },
          ...history,
        ],
      });

      console.log("RAW RESPONSES (by_sources):", JSON.stringify(resp, null, 2));

      const rawAnswer =
        resp.output_text ??
        (Array.isArray(resp.output)
          ? resp.output
              .map((item: any) => item?.content?.[0]?.text?.value ?? "")
              .join("\n")
          : "");

      const webResults = extractWebResults(resp);
      const { headers, rows } = parseMarkdownTable(rawAnswer);
      const linkColIdx = headers.findIndex(
        (h) => h.toLowerCase().includes("ссылка") || h.toLowerCase().includes("url")
      );

      if (linkColIdx !== -1 && rows.length) {
        rows.forEach((row, idx) => {
          while (row.length < headers.length) {
            row.push("");
          }
          const web = webResults[idx];
          if (web?.url) {
            row[linkColIdx] = web.url;
          } else if (!row[linkColIdx]) {
            row[linkColIdx] = "—";
          }
        });

        const finalTable = buildMarkdownTable(headers, rows);
        return NextResponse.json({ answer: finalTable, notice: notices.join(" ") });
      }

      return NextResponse.json({ answer: rawAnswer, notice: notices.join(" ") });
    }

    // ─────────────────────────────────────────────
    // ВЕТКА 2: "подбери источники сам"
    // ─────────────────────────────────────────────

    // если пользователь задал очень узкий период — предупредим на фронте
    if (scenario === "auto_sources" && periodFrom && periodTo) {
      notices.push(
        "Выбран автоматический подбор источников при заданных датах. Фильтры могли быть автоматически расширены, чтобы набрать релевантные документы."
      );
    }

    // шаг 1 — модель подбирает домены БЕЗ нумерации
    const pickResp = await client.responses.create({
      model: modelToUse,
      tools: [{ type: "web_search" } as any],
      input: [
        {
          role: "user",
          content: `Подбери 5–7 доменов для поиска НТИ по теме: ${topic}. Ключевые слова: ${keywords}. Период: ${period}.
ПИШИ ТОЛЬКО домены, по одному в строку, без цифр и комментариев. Примеры: ieeexplore.ieee.org, link.springer.com, www.sciencedirect.com`,
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
      model: modelToUse,
      tools: [
        {
          type: "web_search",
          ...(autoDomains.length ? { filters: { allowed_domains: autoDomains } } : {}),
        } as any,
      ],
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            baseBlock +
            (autoDomains.length
              ? `
Используй для поиска эти источники: ${autoDomains.join(", ")}.
Если за указанный период документов мало — добери из этого же источника за ближайший период (начиная с 2025, затем 2024).
Не запрашивай подтверждений и не предлагай варианты — сразу верни одну таблицу.
В таблице ОБЯЗАТЕЛЬНО заполни "Ссылка (URL)" и "DOI / Номер патента", если они есть. Если нет — ставь "—".
              `.trim()
              : `
Если за указанный период документов мало — добери из ближайшего периода.
Не запрашивай подтверждений. Верни одну таблицу.
              `.trim()),
        },
        ...history,
      ],
    });

    console.log("RAW RESPONSES (auto):", JSON.stringify(searchResp, null, 2));

    const rawAnswer2 =
      searchResp.output_text ??
      (Array.isArray(searchResp.output)
        ? searchResp.output
            .map((item: any) => item?.content?.[0]?.text?.value ?? "")
            .join("\n")
        : "");

    const webResults2 = extractWebResults(searchResp);
    const { headers: headers2, rows: rows2 } = parseMarkdownTable(rawAnswer2);
    const linkColIdx2 = headers2.findIndex(
      (h) => h.toLowerCase().includes("ссылка") || h.toLowerCase().includes("url")
    );

    if (linkColIdx2 !== -1 && rows2.length) {
      rows2.forEach((row, idx) => {
        while (row.length < headers2.length) {
          row.push("");
        }
        const web = webResults2[idx];
        if (web?.url) {
          row[linkColIdx2] = web.url;
        } else if (!row[linkColIdx2]) {
          row[linkColIdx2] = "—";
        }
      });

      const finalTable2 = buildMarkdownTable(headers2, rows2);
      return NextResponse.json({ answer: finalTable2, notice: notices.join(" ") });
    }

    return NextResponse.json({ answer: rawAnswer2, notice: notices.join(" ") });
  } catch (err: any) {
    console.error("chat route error", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}




