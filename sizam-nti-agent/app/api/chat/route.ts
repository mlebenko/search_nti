// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { SYSTEM_PROMPT } from "../../../lib/prompt";

export const dynamic = "force-dynamic";

// соответствие названий источников и доменов
const SOURCE_DOMAIN_MAP: Record<string, string[]> = {
  IEEE: ["ieeexplore.ieee.org"],
  SpringerLink: ["link.springer.com"],
  ScienceDirect: ["www.sciencedirect.com", "sciencedirect.com"],
  Wiley: ["onlinelibrary.wiley.com"],
  PubMed: ["pubmed.ncbi.nlm.nih.gov", "www.ncbi.nlm.nih.gov"],
  arXiv: ["arxiv.org"],
  Scopus: ["www.scopus.com"],
};

// 1) чистим домены: убираем нумерацию, маркеры, протоколы, хвосты
function sanitizeDomains(domains: string[]): string[] {
  return domains
    .map((d) => d.trim())
    // убираем "1. ", "2) ", "-  "
    .map((d) => d.replace(/^[\d\.\-\)\s]+/, ""))
    // убираем http/https
    .map((d) => d.replace(/^https?:\/\//i, ""))
    // берём только первую "словесную" часть, если модель дописала комментарий
    .map((d) => d.split(/\s+/)[0])
    // убираем финальные /
    .map((d) => d.replace(/\/+$/g, ""))
    // выбрасываем мусор
    .filter((d) => d && d.includes("."));
}

// 2) достаём реальные результаты поиска из ответа Responses
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

// 3) парсим markdown-таблицу в заголовки и строки
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
    const cells = line
      .split("|")
      .map((c) => c.trim());
    // убираем первый и последний пустые, если есть
    const normalized = cells.filter((_, idx) => !(idx === 0 || idx === cells.length - 1));
    rows.push(normalized);
  }

  return { headers, rows };
}

// 4) собираем markdown-таблицу обратно
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

    // ─────────────────────────────────────────────
    // ВЕТКА 1: пользователь выбрал конкретные источники
    // ─────────────────────────────────────────────
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
              `
Ограничь поиск указанными источниками.
В итоговой таблице ОБЯЗАТЕЛЬНО заполни колонку "Ссылка (URL)" на страницу документа/публикации/патента, если она есть в результатах поиска.
Если ссылку найти нельзя — поставь "—".
Выведи одну таблицу.
              `.trim(),
          },
          ...history,
        ],
      });

      console.log("RAW RESPONSES (by_sources):", JSON.stringify(resp, null, 2));

      // что сказала модель текстом
      const rawAnswer =
        resp.output_text ??
        (Array.isArray(resp.output)
          ? resp.output
              .map((item: any) => item?.content?.[0]?.text?.value ?? "")
              .join("\n")
          : "");

      // а что реально вернул инструмент
      const webResults = extractWebResults(resp);

      // парсим таблицу
      const { headers, rows } = parseMarkdownTable(rawAnswer);

      // ищем колонку со ссылкой
      const linkColIdx = headers.findIndex((h) =>
        h.toLowerCase().includes("ссылка") || h.toLowerCase().includes("url")
      );

      if (linkColIdx !== -1 && rows.length) {
        rows.forEach((row, idx) => {
          // расширяем строку до длины headers
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
        return NextResponse.json({ answer: finalTable });
      } else {
        // если модель не дала таблицу — отдаём как есть
        return NextResponse.json({ answer: rawAnswer });
      }
    }

    // ─────────────────────────────────────────────
    // ВЕТКА 2: "подбери источники сам"
    // ─────────────────────────────────────────────

    // шаг 1 — просим модель вывести домены БЕЗ нумерации
    const pickResp = await client.responses.create({
      model: "gpt-4o",
      tools: [{ type: "web_search" } as any],
      input: [
        {
          role: "user",
          content: `Подбери 5-7 доменов для поиска НТИ по теме: ${topic}. Ключевые слова: ${keywords}. Период: ${period}. 
ПИШИ ТОЛЬКО домены, по одному в строку, без цифр, без тире, без комментариев. Примеры: ieeexplore.ieee.org, link.springer.com`,
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

    // шаг 2 — основной поиск по подобранным доменам
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
              ? `
Используй для поиска эти источники: ${autoDomains.join(", ")}.
В таблице ОБЯЗАТЕЛЬНО заполни "Ссылка (URL)" и "DOI / Номер патента", если они есть в результатах поиска.
Если нет — ставь "—".
Выведи одну таблицу.
              `.trim()
              : `
Выведи одну таблицу. Если ссылки нет — ставь "—".
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
    const linkColIdx2 = headers2.findIndex((h) =>
      h.toLowerCase().includes("ссылка") || h.toLowerCase().includes("url")
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
      return NextResponse.json({ answer: finalTable2 });
    }

    return NextResponse.json({ answer: rawAnswer2 });
  } catch (err: any) {
    console.error("chat route error", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
