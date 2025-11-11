"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SOURCE_OPTIONS = [
  "IEEE",
  "SpringerLink",
  "ScienceDirect",
  "Wiley",
  "PubMed",
  "arXiv",
  "Scopus",
];

const DOC_TYPE_OPTIONS = [
  { value: "article", label: "Статьи / журналы" },
  { value: "conference", label: "Материалы конференций" },
  { value: "review", label: "Обзоры" },
  { value: "patent", label: "Патенты" },
  { value: "report", label: "Тех. отчёты / гос. публикации" },
];

const MODEL_OPTIONS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-5-thinking", label: "GPT-5 Thinking" },
];

// утилита: вытаскиваем таблицу из markdown-а
function parseMarkdownTable(md: string) {
  const lines = md.split("\n").map((l) => l.trim());
  const headerLineIndex = lines.findIndex((l) => l.startsWith("|"));
  if (headerLineIndex === -1) {
    return { headers: [], rows: [] };
  }
  const headerLine = lines[headerLineIndex];
  const headers = headerLine
    .split("|")
    .map((h) => h.trim())
    .filter(Boolean);

  // строка-разделитель после заголовка
  const rows: string[][] = [];
  for (let i = headerLineIndex + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .map((c) => c.trim())
      .filter((_, idx, arr) => !(idx === 0 || idx === arr.length - 1));
    rows.push(cells);
  }
  return { headers, rows };
}

export default function HomePage() {
  const [topic, setTopic] = useState("");
  const [keywords, setKeywords] = useState("");
  const [periodFrom, setPeriodFrom] = useState("");
  const [periodTo, setPeriodTo] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [scenario, setScenario] = useState<"by_sources" | "auto_sources">(
    "by_sources"
  );
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const [docTypes, setDocTypes] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>(["Английский"]);
  const [needRu, setNeedRu] = useState(true);
  const [needMetrics, setNeedMetrics] = useState(true);
  const [model, setModel] = useState("gpt-4o");
  const [notice, setNotice] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [expandedCards, setExpandedCards] = useState<Record<number, boolean>>(
    {}
  );

  const toggleSource = (s: string) => {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].slice(0, 5)
    );
  };

  const toggleDocType = (val: string) => {
    setDocTypes((prev) =>
      prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAnswer("");
    setNotice("");

    const res = await fetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        topic,
        keywords,
        periodFrom,
        periodTo,
        sources,
        scenario,
        history,
        docTypes,
        languages,
        needRu,
        needMetrics,
        model,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    setLoading(false);

    if (res.ok && data.answer) {
      setAnswer(data.answer);
      setNotice(data.notice || "");
      setHistory((prev) => [
        ...prev,
        {
          role: "user",
          content: `Тема: ${topic}; ключевые: ${keywords}; период: ${periodFrom} — ${periodTo}`,
        },
        { role: "assistant", content: data.answer },
      ]);
    } else {
      setAnswer(data.error || "Не удалось получить ответ от агента.");
      setNotice("");
    }
  };

  const handleMore = async () => {
    setLoading(true);

    const res = await fetch("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        topic,
        keywords,
        periodFrom,
        periodTo,
        sources,
        scenario,
        docTypes,
        languages,
        needRu,
        needMetrics,
        model,
        history: [
          ...history,
          {
            role: "user",
            content:
              "Дай следующую подборку других документов по той же теме. НЕ повторяй документы из предыдущей таблицы. По возможности используй другие источники.",
          },
        ],
      }),
      headers: { "Content-Type": "application/json" },
    });

    const data = await res.json();
    setLoading(false);

    if (data.answer) {
      setAnswer(data.answer);
      setNotice(data.notice || "");
      setHistory((prev) => [
        ...prev,
        {
          role: "user",
          content:
            "Дай следующую подборку других документов по той же теме. НЕ повторяй документы из предыдущей таблицы.",
        },
        { role: "assistant", content: data.answer },
      ]);
    }
  };

  // для карточек парсим ответ
  const { headers, rows } = parseMarkdownTable(answer);

  return (
    <main
      style={{
        maxWidth: "1120px",
        margin: "0 auto",
        padding: "24px",
        display: "grid",
        gap: "20px",
      }}
    >
      <header>
        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 600 }}>
          SIZAM NTI Agent
        </h1>
        <p style={{ margin: "6px 0 0", color: "#475569" }}>
          Форма для запроса НТИ: соберите параметры — агент вернёт таблицу или
          карточки документов.
        </p>
      </header>

      {/* ФОРМА */}
      <section
        style={{
          display: "grid",
          gap: "18px",
          background: "#FFFFFF",
          border: "1px solid #E5E7EB",
          borderRadius: "16px",
          boxShadow:
            "0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(15,23,42,.08)",
          padding: "18px",
        }}
      >
        {/* выбор модели */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <label style={{ fontWeight: 500 }}>Модель</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            style={{
              border: "1px solid #E5E7EB",
              borderRadius: "10px",
              padding: "6px 10px",
            }}
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px" }}>
          <label style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontWeight: 500 }}>Тема / запрос</span>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={3}
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: "12px",
                padding: "10px",
                fontFamily: "inherit",
              }}
              placeholder="Например: LPI/LPD radar для военных применений..."
              required
            />
          </label>

          <label style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontWeight: 500 }}>Ключевые слова</span>
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              style={{
                border: "1px solid #E5E7EB",
                borderRadius: "12px",
                padding: "8px 10px",
              }}
              placeholder="radar, LPI, low probability of detection..."
            />
          </label>

          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ fontWeight: 500 }}>Период с</span>
              <input
                type="date"
                value={periodFrom}
                onChange={(e) => setPeriodFrom(e.target.value)}
                style={{
                  border: "1px solid #E5E7EB",
                  borderRadius: "12px",
                  padding: "6px 8px",
                }}
                required
              />
            </label>
            <label style={{ display: "grid", gap: "6px" }}>
              <span style={{ fontWeight: 500 }}>по</span>
              <input
                type="date"
                value={periodTo}
                onChange={(e) => setPeriodTo(e.target.value)}
                style={{
                  border: "1px solid #E5E7EB",
                  borderRadius: "12px",
                  padding: "6px 8px",
                }}
                required
              />
            </label>
          </div>

          {/* источники */}
          <div style={{ display: "grid", gap: "8px" }}>
            <span style={{ fontWeight: 500 }}>Источники (до 5)</span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {SOURCE_OPTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSource(s)}
                  style={{
                    height: "32px",
                    padding: "0 12px",
                    borderRadius: "9999px",
                    border: sources.includes(s)
                      ? "1px solid transparent"
                      : "1px solid #E5E7EB",
                    background: sources.includes(s) ? "#2563EB" : "#F1F5F9",
                    color: sources.includes(s) ? "#fff" : "#0F172A",
                    fontWeight: 500,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* типы документов */}
          <div style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontWeight: 500 }}>Типы документов</span>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              {DOC_TYPE_OPTIONS.map((dt) => (
                <label
                  key={dt.value}
                  style={{ display: "flex", gap: "4px", alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    checked={docTypes.includes(dt.value)}
                    onChange={() => toggleDocType(dt.value)}
                  />
                  {dt.label}
                </label>
              ))}
            </div>
          </div>

          {/* сценарий */}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <input
                type="radio"
                name="scenario"
                value="by_sources"
                checked={scenario === "by_sources"}
                onChange={() => setScenario("by_sources")}
              />
              <span>Использовать выбранные источники</span>
            </label>
            <label style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <input
                type="radio"
                name="scenario"
                value="auto_sources"
                checked={scenario === "auto_sources"}
                onChange={() => setScenario("auto_sources")}
              />
              <span>Пусть ассистент подберёт источники</span>
            </label>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              background: "#2563EB",
              color: "#fff",
              border: "none",
              borderRadius: "12px",
              height: "42px",
              fontWeight: 600,
              cursor: "pointer",
              opacity: loading ? 0.8 : 1,
            }}
          >
            {loading ? "Ищем документы..." : "Запросить документы"}
          </button>
        </form>
      </section>

      {/* РЕЗУЛЬТАТ */}
      <section
        style={{
          background: "#FFFFFF",
          border: "1px solid #E5E7EB",
          borderRadius: "16px",
          boxShadow:
            "0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(15,23,42,.08)",
          padding: "18px",
          minHeight: "200px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            gap: "12px",
            alignItems: "center",
          }}
        >
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Результат</h2>
          <div
            style={{
              display: "flex",
              background: "#F1F5F9",
              borderRadius: "9999px",
              padding: "4px",
              gap: "4px",
            }}
          >
            <button
              onClick={() => setViewMode("table")}
              style={{
                border: "none",
                background: viewMode === "table" ? "#FFFFFF" : "transparent",
                borderRadius: "9999px",
                padding: "4px 10px",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              Таблица
            </button>
            <button
              onClick={() => setViewMode("cards")}
              style={{
                border: "none",
                background: viewMode === "cards" ? "#FFFFFF" : "transparent",
                borderRadius: "9999px",
                padding: "4px 10px",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              Карточки
            </button>
          </div>
        </div>

        {notice ? (
          <div
            style={{
              marginTop: "12px",
              marginBottom: "12px",
              background: "#FEF3C7",
              border: "1px solid #FDE68A",
              borderRadius: "8px",
              padding: "8px 12px",
              color: "#92400E",
              fontSize: "14px",
            }}
          >
            {notice}
          </div>
        ) : null}

        {answer ? (
          <>
            {viewMode === "table" ? (
              <div
                style={{
                  overflowX: "auto",
                  border: "1px solid #E2E8F0",
                  borderRadius: "12px",
                }}
              >
                <div
                  style={{
                    minWidth: "720px",
                  }}
                >
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      table: ({ node, ...props }) => (
                        <table
                          style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            fontSize: "13px",
                          }}
                          {...props}
                        />
                      ),
                      th: ({ node, ...props }) => (
                        <th
                          style={{
                            background: "#F8FAFC",
                            border: "1px solid #E2E8F0",
                            textAlign: "left",
                            padding: "6px 8px",
                            whiteSpace: "nowrap",
                          }}
                          {...props}
                        />
                      ),
                      td: ({ node, ...props }) => (
                        <td
                          style={{
                            border: "1px solid #E2E8F0",
                            padding: "6px 8px",
                            verticalAlign: "top",
                          }}
                          {...props}
                        />
                      ),
                    }}
                  >
                    {answer}
                  </ReactMarkdown>
                </div>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: "12px",
                  marginTop: "10px",
                }}
              >
                {rows.length === 0 ? (
                  <p style={{ color: "#94A3B8" }}>
                    Не удалось распарсить таблицу в карточки.
                  </p>
                ) : (
                  rows.map((row, idx) => {
                    const get = (colName: string) => {
                      const colIdx = headers.findIndex((h) =>
                        h.toLowerCase().includes(colName)
                      );
                      return colIdx !== -1 ? row[colIdx] || "" : "";
                    };

                    const title =
                      get("название (рус") ||
                      get("название") ||
                      get("title") ||
                      `Документ ${idx + 1}`;
                    const source =
                      get("источник") || get("source") || "Источник не указан";
                    const date = get("дата") || "";
                    const type = get("тип документа") || "";
                    const url = get("ссылка") || "";
                    const annRu = get("аннотация (рус") || "";
                    const isExpanded = expandedCards[idx];

                    return (
                      <div
                        key={idx}
                        style={{
                          border: "1px solid #E2E8F0",
                          borderRadius: "14px",
                          padding: "10px 12px",
                          background: "#FFFFFF",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: "12px",
                          }}
                        >
                          <div>
                            <div
                              style={{
                                fontWeight: 600,
                                marginBottom: "2px",
                              }}
                            >
                              {title}
                            </div>
                            <div style={{ fontSize: "12px", color: "#64748B" }}>
                              {type && <span>{type} · </span>}
                              {source}
                              {date ? ` · ${date}` : null}
                            </div>
                          </div>
                          {url && url !== "—" ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: "12px",
                                color: "#2563EB",
                                textDecoration: "none",
                                whiteSpace: "nowrap",
                              }}
                            >
                              Открыть →
                            </a>
                          ) : null}
                        </div>

                        {annRu ? (
                          <div style={{ marginTop: "6px", fontSize: "13px" }}>
                            {isExpanded
                              ? annRu
                              : annRu.slice(0, 160) +
                                (annRu.length > 160 ? "..." : "")}
                            {annRu.length > 160 ? (
                              <button
                                onClick={() =>
                                  setExpandedCards((prev) => ({
                                    ...prev,
                                    [idx]: !prev[idx],
                                  }))
                                }
                                style={{
                                  background: "transparent",
                                  border: "none",
                                  color: "#2563EB",
                                  cursor: "pointer",
                                  marginLeft: "4px",
                                  fontSize: "12px",
                                }}
                              >
                                {isExpanded ? "Свернуть" : "Развернуть"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            <button
              onClick={handleMore}
              style={{
                marginTop: "12px",
                background: "#F1F5F9",
                border: "1px solid #E5E7EB",
                borderRadius: "10px",
                padding: "6px 10px",
                cursor: "pointer",
              }}
            >
              Ещё документы
            </button>
          </>
        ) : (
          <p style={{ color: "#94A3B8", marginTop: "14px" }}>
            Ответ ассистента появится здесь в виде таблицы или карточек.
          </p>
        )}
      </section>
    </main>
  );
}




















