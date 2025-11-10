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

// маленькая функция, чтобы развернуть таблицу в несколько строк
function normalizeTable(md: string) {
  // если уже есть переносы строк — ничего не делаем
  if (md.includes("\n|")) return md;

  return md
    // разделитель на новую строку
    .replace(/\|\s*-{3,}\s*\|/g, "\n|---|")
    // строки с номером на новую строку
    .replace(/\|\s*(\d+)\s*\|/g, "\n| $1 |")
    // иногда модель ставит "| |" в конец
    .replace(/\|\s*\|/g, "|\n")
    .trim();
}

function mergeMarkdownTables(oldTable: string, newTable: string) {
  if (!oldTable) return newTable;
  if (!newTable) return oldTable;

  const oldLines = oldTable.trim().split("\n");
  const newLines = newTable.trim().split("\n");

  if (oldLines.length < 2) return newTable;
  if (newLines.length < 2) return oldTable;

  const header = oldLines[0];
  const separator = oldLines[1];

  const oldRows = oldLines.slice(2);
  const newRows = newLines.slice(2);

  // кладём старые строки в set, чтобы быстро проверять
  const existing = new Set(oldRows.map((r) => r.trim()));

  const dedupedNewRows = newRows.filter((r) => {
    const trimmed = r.trim();
    if (!trimmed) return false;
    return !existing.has(trimmed);
  });

  const merged = [header, separator, ...oldRows, ...dedupedNewRows];
  return merged.join("\n");
}

function parseMarkdownTable(md: string) {
  if (!md) return [];

  const lines = md.trim().split("\n").filter(Boolean);
  if (lines.length < 3) return [];

  const headerLine = lines[0];
  const headers = headerLine
    .split("|")
    .map((h) => h.trim())
    .filter((h) => h !== "");

  const rows = lines.slice(2); // пропускаем header и "---"

  return rows
    .map((line) => {
      if (!line.includes("|")) return null;
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      if (!cells.length) return null;

      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = cells[idx] || "";
      });
      return obj;
    })
    .filter(Boolean) as Array<Record<string, string>>;
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

  // новые состояния
  const [docTypes, setDocTypes] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>(["Английский"]);
  const [needRu, setNeedRu] = useState(true);
  const [needMetrics, setNeedMetrics] = useState(true);
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [expandedCards, setExpandedCards] = useState<number[]>([]);
  const toggleSource = (s: string) => {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s].slice(0, 5)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAnswer("");

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
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    setLoading(false);

    if (res.ok && data.answer) {
      const normalized = normalizeTable(data.answer);
      setAnswer(normalized);
      setHistory((prev) => [
        ...prev,
        {
          role: "user",
          content: `Тема: ${topic}; ключевые: ${keywords}; период: ${periodFrom} — ${periodTo}`,
        },
        { role: "assistant", content: normalized },
      ]);
    } else {
      setAnswer(data.error || "Не удалось получить ответ от агента.");
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
      history: [
        ...history,
        {
          role: "user",
          content:
            "Дай следующую подборку других документов по той же теме. НЕ повторяй документы из предыдущей таблицы. По возможности используй другие источники из списка, но только если они не хуже по релевантности.",
        },
      ],
    }),
    headers: { "Content-Type": "application/json" },
  });

  const data = await res.json();
  console.log("MORE response", data);
  setLoading(false);

  if (res.ok && data.answer) {
    const normalized = normalizeTable(data.answer);
    setAnswer((prev) => mergeMarkdownTables(prev, normalized));
    setHistory((prev) => [
      ...prev,
      {
        role: "user",
        content:
          "Дай следующую подборку других документов по той же теме. НЕ повторяй документы из предыдущей таблицы. По возможности используй другие источники из списка, но только если они не хуже по релевантности.",
      },
      { role: "assistant", content: normalized },
    ]);
  } else {
    setAnswer(data.error || "Не удалось получить ответ от агента.");
  }
};

  
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
          Форма для запроса НТИ: соберите параметры — агент вернёт таблицу
          документов.
        </p>
      </header>

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
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: "14px" }}>
          {/* Тема */}
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
              placeholder="Например: поиск публикаций по коррозионной стойкости материалов для морских платформ"
              required
            />
          </label>

          {/* Ключевые */}
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
              placeholder="corrosion, offshore, materials..."
            />
          </label>

          {/* Период */}
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

          {/* Источники */}
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

          {/* Типы документов */}
          <div style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontWeight: 500 }}>Типы документов</span>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {[
                "Статьи",
                "Материалы конференций",
                "Патенты",
                "Препринты",
                "Обзоры",
              ].map((t) => (
                <label
                  key={t}
                  style={{ display: "flex", gap: "6px", alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    checked={docTypes.includes(t)}
                    onChange={() =>
                      setDocTypes((prev) =>
                        prev.includes(t)
                          ? prev.filter((x) => x !== t)
                          : [...prev, t]
                      )
                    }
                  />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Языки */}
          <div style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontWeight: 500 }}>Языки источников</span>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap" }}>
              {["Английский", "Русский"].map((lang) => (
                <label
                  key={lang}
                  style={{ display: "flex", gap: "6px", alignItems: "center" }}
                >
                  <input
                    type="checkbox"
                    checked={languages.includes(lang)}
                    onChange={() =>
                      setLanguages((prev) =>
                        prev.includes(lang)
                          ? prev.filter((x) => x !== lang)
                          : [...prev, lang]
                      )
                    }
                  />
                  <span>{lang}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Переключатели */}
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={needRu}
                onChange={(e) => setNeedRu(e.target.checked)}
              />
              <span>Добавить русские названия и аннотации</span>
            </label>
            <label style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={needMetrics}
                onChange={(e) => setNeedMetrics(e.target.checked)}
              />
              <span>Добавить метрики и релевантность</span>
            </label>
          </div>

          {/* Сценарий */}
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

     <section
  style={{
    background: "#FFFFFF",
    border: "1px solid #E5E7EB",
    borderRadius: "16px",
    boxShadow: "0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(15,23,42,.08)",
    padding: "18px",
    minHeight: "200px",
  }}
>
  <h2 style={{ marginTop: 0 }}>Результат</h2>
  {answer ? (
    <>
      {/* переключатель представления */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "12px" }}>
        <button
          type="button"
          onClick={() => setViewMode("cards")}
          style={{
            border: `1px solid ${
              viewMode === "cards" ? "#2563EB" : "#E2E8F0"
            }`,
            background: viewMode === "cards" ? "#EFF6FF" : "#fff",
            borderRadius: "10px",
            padding: "4px 10px",
            fontSize: "12px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Карточки
        </button>
        <button
          type="button"
          onClick={() => setViewMode("table")}
          style={{
            border: `1px solid ${
              viewMode === "table" ? "#2563EB" : "#E2E8F0"
            }`,
            background: viewMode === "table" ? "#EFF6FF" : "#fff",
            borderRadius: "10px",
            padding: "4px 10px",
            fontSize: "12px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          Таблица
        </button>
      </div>

      {viewMode === "cards" ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "14px",
          }}
        >
          {parseMarkdownTable(answer).map((row, idx) => {
            const ann = row["Аннотация (русский перевод)"] || "";
            const isExpanded = expandedCards.includes(idx);
            const isLong = ann.length > 170;

            return (
              <div
                key={row["Ссылка (URL)"] || row["№"] || idx}
                style={{
                  background: "#fff",
                  border: "1px solid #E2E8F0",
                  borderRadius: "14px",
                  padding: "12px 12px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  boxShadow:
                    "0 1px 2px rgba(15,23,42,0.03), 0 8px 24px rgba(15,23,42,0.04)",
                }}
              >
                {/* верх карточки */}
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {row["Тип документа"] ? (
                    <span
                      style={{
                        background: "#EFF6FF",
                        color: "#1D4ED8",
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "9999px",
                        fontWeight: 500,
                      }}
                    >
                      {row["Тип документа"]}
                    </span>
                  ) : null}
                  {row["Источник"] ? (
                    <span
                      style={{
                        background: "#F8FAFC",
                        color: "#475569",
                        fontSize: "11px",
                        padding: "2px 8px",
                        borderRadius: "9999px",
                      }}
                    >
                      {row["Источник"]}
                    </span>
                  ) : null}
                  {row["Дата публикации (ДД.ММ.ГГГГ)"] ? (
                    <span style={{ fontSize: "11px", color: "#94A3B8" }}>
                      {row["Дата публикации (ДД.ММ.ГГГГ)"]}
                    </span>
                  ) : null}
                </div>

                {/* заголовок */}
                <div>
                  <h3
                    style={{
                      fontSize: "14px",
                      margin: "2px 0 4px",
                      lineHeight: 1.25,
                    }}
                  >
                    {row["Название (оригинал)"] || "Без названия"}
                  </h3>
                  {row["Название (русский перевод)"] ? (
                    <p
                      style={{ fontSize: "12px", color: "#475569", margin: 0 }}
                    >
                      {row["Название (русский перевод)"]}
                    </p>
                  ) : null}
                </div>

                {/* аннотация с разворотом */}
                {ann ? (
                  <div style={{ marginTop: "2px" }}>
                    <p
                      style={{
                        fontSize: "12px",
                        color: "#64748B",
                        margin: 0,
                        lineHeight: 1.35,
                        ...(isExpanded
                          ? {}
                          : {
                              maxHeight: "3.3em",
                              overflow: "hidden",
                            }),
                      }}
                    >
                      {ann}
                    </p>
                    {isLong ? (
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedCards((prev) =>
                            prev.includes(idx)
                              ? prev.filter((i) => i !== idx)
                              : [...prev, idx]
                          )
                        }
                        style={{
                          marginTop: "4px",
                          background: "transparent",
                          border: "none",
                          color: "#2563EB",
                          fontSize: "11px",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      >
                        {isExpanded ? "Свернуть" : "Показать полностью"}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* низ карточки */}
                <div
                  style={{
                    marginTop: "auto",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                  }}
                >
                  {row["Релевантность"] ? (
                    <span
                      style={{
                        fontSize: "11px",
                        color: "#0F172A",
                        background: "#F1F5F9",
                        borderRadius: "9999px",
                        padding: "3px 8px",
                      }}
                    >
                      Релевантность: {row["Релевантность"]}
                    </span>
                  ) : (
                    <span />
                  )}

                  {row["Ссылка (URL)"] ? (
                    <a
                      href={row["Ссылка (URL)"]}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: "11px",
                        color: "#2563EB",
                        textDecoration: "none",
                        fontWeight: 500,
                      }}
                    >
                      Открыть
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // таблица
        <div style={{ overflowX: "auto" }}>
          <div className="nti-table">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {answer}
            </ReactMarkdown>
          </div>
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
    <p style={{ color: "#94A3B8" }}>
      Ответ ассистента появится здесь в виде таблицы или карточек.
    </p>
  )}
</section>

    </main>
  );
}















