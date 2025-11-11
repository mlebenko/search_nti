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

// модели, между которыми ты хочешь переключаться
const MODEL_OPTIONS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-5", label: "GPT-5" },
  { value: "gpt-5-thinking", label: "GPT-5 Thinking" },
];

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
  const [model, setModel] = useState("gpt-4o"); // 👈 новое состояние

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
        model, // 👈 отправляем выбранную модель
      }),
      headers: {
        "Content-Type": "application/json",
      },
    });

    const data = await res.json();
    setLoading(false);

    if (res.ok && data.answer) {
      setAnswer(data.answer);
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
        model, // 👈 и сюда тоже
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
              placeholder="Например: поиск публикаций по коррозионной стойкости материалов для морских платформ"
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
              placeholder="corrosion, offshore, materials..."
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
          boxShadow:
            "0 1px 2px rgba(0,0,0,.06), 0 10px 30px rgba(15,23,42,.08)",
          padding: "18px",
          minHeight: "200px",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Результат</h2>
        {answer ? (
          <>
            <div style={{ overflowX: "auto" }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {answer}
              </ReactMarkdown>
            </div>
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
            Ответ ассистента появится здесь в виде таблицы.
          </p>
        )}
      </section>
    </main>
  );
}
















